import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  StyleSheet,
  Text,
  Alert,
  BackHandler,
  Image,
  Dimensions,
  TouchableOpacity,
  Modal,
  PermissionsAndroid,
  Platform,
  AppState,
  ScrollView,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import EncryptedStorage from 'react-native-encrypted-storage';
import axios from 'axios';
import {
  useRoute,
  useNavigation,
  CommonActions,
  useFocusEffect,
} from '@react-navigation/native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import polyline from '@mapbox/polyline';
import Entypo from 'react-native-vector-icons/Entypo';
import { SafeAreaView } from 'react-native-safe-area-context';

// Import local images
const startMarker = require('../assets/start-marker.png');
// const endMarker = require('./assets/end-marker.png');
const endMarker = require('../assets/end-marker.png');

Mapbox.setAccessToken(
  'pk.eyJ1IjoieWFzd2FudGh2YW5hbWEiLCJhIjoiY20ybTMxdGh3MGZ6YTJxc2Zyd2twaWp2ZCJ9.uG0mVTipkeGVwKR49iJTbw',
);

const Navigation = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const [routeData, setRouteData] = useState(null);
  const [locationDetails, setLocationDetails] = useState(null);
  const [decodedId, setDecodedId] = useState(null);
  const [addressDetails, setAddressDetails] = useState({});
  const [encodedData, setEncodedData] = useState(null);
  const [pin, setPin] = useState('');
  const [serviceArray, setServiceArray] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [confirmationModalVisible, setConfirmationModalVisible] =
    useState(false);
  const [cameraBounds, setCameraBounds] = useState(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [showUpArrowService, setShowUpArrowService] = useState(false);
  const [showDownArrowService, setShowDownArrowService] = useState(false);

  // Handle App State Changes


  // Request Location Permissions
  useEffect(() => {
    const requestLocationPermission = async () => {
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: 'Location Permission',
              message: 'This app needs access to your location',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            },
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            console.log('Location permission denied');
          }
        } catch (err) {
          console.warn(err);
        }
      }
    };

    requestLocationPermission();
  }, []);

  const handleServiceScroll = event => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const containerHeight = event.nativeEvent.layoutMeasurement.height;
    const contentHeight = event.nativeEvent.contentSize.height;

    // Show the up arrow if not at the top
    setShowUpArrowService(offsetY > 0);

    // Show the down arrow if the container isn’t scrolled all the way down
    setShowDownArrowService(offsetY + containerHeight < contentHeight);
  };

  // Decode Encoded ID
  useEffect(() => {
    const {encodedId} = route.params;
    setEncodedData(encodedId);
    if (encodedId) {
      try {
        setDecodedId(atob(encodedId));
      } catch (error) {
        console.error('Error decoding Base64:', error);
      }
    }
  }, [route.params]);

  // Handle Back Button
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{name: 'Tabs', state: {routes: [{name: 'Home'}]}}],
          }),
        );
        return true;
      };
      BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () =>
        BackHandler.removeEventListener('hardwareBackPress', onBackPress);
    }, [navigation]),
  );

  // Fetch Worker Details
  useEffect(() => {
    const fetchWorkerDetails = async () => {
      const jwtToken = await EncryptedStorage.getItem('cs_token');
      try {
        const response = await axios.post(
          `https://backend.clicksolver.com/api/worker/navigation/details`,
          {notificationId: decodedId},
          {headers: {Authorization: `Bearer ${jwtToken}`}},
        );

        if (response.status === 404) {
          navigation.navigate('SkillRegistration');
        } else {
          const {
            name,
            phone_number,
            pin,
            profile,
            pincode,
            area,
            city,
            service_booked,
          } = response.data;
          const pinString = String(pin);
          const details = {
            name,
            phone_number,
            profile,
            pincode,
            area,
            city,
            service: service_booked,
          };
          setPin(pinString);
          setAddressDetails(details);
          setServiceArray(service_booked);
        }
      } catch (error) {
        console.error('Error fetching worker details:', error);
      }
    };

    if (decodedId) fetchWorkerDetails();
  }, [decodedId, navigation]);

  // Check Verification Status
  useEffect(() => {
    const checkVerificationStatus = async () => {
      try {
        const response = await axios.get(
          `https://backend.clicksolver.com/api/worker/verification/status`,
          {params: {notification_id: decodedId}},
        );

        if (response.data === 'true') {
          const cs_token = await EncryptedStorage.getItem('cs_token');
          await axios.post(
            `https://backend.clicksolver.com/api/user/action`,
            {
              encodedId: encodedData,
              screen: 'worktimescreen',
            },
            {
              headers: {Authorization: `Bearer ${cs_token}`},
            },
          );

          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [
                {name: 'worktimescreen', params: {encodedId: encodedData}},
              ],
            }),
          );
        }
      } catch (error) {
        console.error('Error checking verification status:', error);
      }
    };

    if (decodedId) checkVerificationStatus();
  }, [decodedId, encodedData, navigation]);

  // Fetch Location Details and Route
  useEffect(() => {
    const fetchOlaRoute = async (startPoint, endPoint, waypoints = []) => {
      try {
        const apiKey = 'iN1RT7PQ41Z0DVxin6jlf7xZbmbIZPtb9CyNwtlT';

        // Construct the base URL with origin and destination
        let url = `https://api.olamaps.io/routing/v1/directions?origin=${startPoint[1]},${startPoint[0]}&destination=${endPoint[1]},${endPoint[0]}&api_key=${apiKey}`;

        // Add waypoints if any
        if (waypoints.length > 0) {
          const waypointParams = waypoints
            .map(point => `${point[1]},${point[0]}`)
            .join('|');
          url += `&waypoints=${encodeURIComponent(waypointParams)}`;
        }

        const response = await axios.post(
          url,
          {},
          {
            headers: {
              'X-Request-Id': 'unique-request-id', // Replace with actual request ID if needed
            },
          },
        );

        const routeData = response.data.routes[0].overview_polyline;
        const decodedCoordinates = polyline
          .decode(routeData)
          .map(coord => [coord[1], coord[0]]); // Map to [lng, lat]

        return {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: decodedCoordinates,
          },
        };
      } catch (error) {
        console.error('Error fetching route from Ola Maps:', error);
      }
    };

    const fetchRoute = async (startPoint, endPoint) => {
      try {
        const olaRouteData = await fetchOlaRoute(startPoint, endPoint);
        console.log('Ola Route Data:', olaRouteData);
        if (
          olaRouteData &&
          olaRouteData.geometry &&
          olaRouteData.geometry.coordinates.length > 0
        ) {
          setRouteData(olaRouteData); // Only set if coordinates are non-empty
        } else {
          console.error('Route data has empty coordinates:', olaRouteData);
        }
      } catch (error) {
        console.error('Error fetching route:', error);
      }
    };

    const fetchLocationDetails = async () => {
      console.log('Fetching location details for decodedId:', decodedId);
      try {
        const response = await axios.get(
          `https://backend.clicksolver.com/api/user/location/navigation`,
          {params: {notification_id: decodedId}},
        );
        console.log('Location Details Response:', response.data);
        const {startPoint, endPoint} = response.data;
        const reversedStart = startPoint.map(parseFloat).reverse();
        const reversedEnd = endPoint.map(parseFloat).reverse();
        setLocationDetails({startPoint: reversedStart, endPoint: reversedEnd});
        fetchRoute(reversedStart, reversedEnd);
      } catch (error) {
        console.error('Error fetching location details:', error);
      }
    };

    if (decodedId) {
      fetchLocationDetails();
      const intervalId = setInterval(fetchLocationDetails, 60000);
      return () => clearInterval(intervalId);
    }
  }, [decodedId]);

  // useEffect(() => {
  //   const subscription = AppState.addEventListener('change', nextAppState => {
  //     if (appState.match(/inactive|background/) && nextAppState === 'active') {
  //       // App has come to the foreground, refetch data
  //       if (decodedId) {
  //         fetchLocationDetails();
  //       }
  //     }
  //     setAppState(nextAppState);
  //   });

  //   return () => {
  //     subscription.remove();
  //   };
  // }, [appState, decodedId]);

  // Compute Bounding Box
  useEffect(() => {
    if (
      locationDetails &&
      routeData &&
      routeData.geometry &&
      routeData.geometry.coordinates.length > 0
    ) {
      const allCoordinates = [
        locationDetails.startPoint,
        locationDetails.endPoint,
        ...routeData.geometry.coordinates,
      ];

      const bounds = computeBoundingBox(allCoordinates);
      console.log('Computed Bounds:', bounds);
      setCameraBounds(bounds);
    }
  }, [locationDetails, routeData]);

  const computeBoundingBox = coordinates => {
    let minX, minY, maxX, maxY;

    for (let coord of coordinates) {
      const [x, y] = coord;
      if (minX === undefined || x < minX) {
        minX = x;
      }
      if (maxX === undefined || x > maxX) {
        maxX = x;
      }
      if (minY === undefined || y < minY) {
        minY = y;
      }
      if (maxY === undefined || y > maxY) {
        maxY = y;
      }
    }

    return {
      ne: [maxX, maxY], // North East coordinate
      sw: [minX, minY], // South West coordinate
    };
  };

  // Handle Cancel Booking
  const handleCancelBooking = useCallback(async () => {
    setConfirmationModalVisible(false);
    setModalVisible(false);
    try {
      const response = await axios.post(
        `https://backend.clicksolver.com/api/user/work/cancel`,
        {notification_id: decodedId},
      );
      console.log('Cancellation Response:', response.status);
      if (response.status === 200) {
        const cs_token = await EncryptedStorage.getItem('cs_token');
        await axios.post(
          `https://backend.clicksolver.com/api/user/action`,
          {
            encodedId: encodedData,
            screen: '',
          },
          {
            headers: {Authorization: `Bearer ${cs_token}`},
          },
        );

        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{name: 'Tabs', state: {routes: [{name: 'Home'}]}}],
          }),
        );
      } else {
        Alert.alert(
          'Cancellation failed',
          'Your cancellation time of 2 minutes is over.',
        );
      }
    } catch (error) {
      console.error('Error cancelling booking:', error);
      Alert.alert('Error', 'There was an error processing your cancellation.');
    }
  }, [decodedId, encodedData, navigation]);

  // Handle Cancel Modal
  const handleCancelModal = () => {
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
  };

  const openConfirmationModal = () => {
    setConfirmationModalVisible(true);
  };

  const closeConfirmationModal = () => {
    setConfirmationModalVisible(false);
  };

  // Markers
  let markers = null;
  if (locationDetails) {
    markers = {
      type: 'FeatureCollection',
      features: [
        // Start Marker
        {
          type: 'Feature',
          properties: {
            icon: 'start-point-icon',
            iconSize: 0.2, // Adjust as needed
          },
          geometry: {
            type: 'Point',
            coordinates: locationDetails.startPoint,
          },
        },
        // End Marker
        {
          type: 'Feature',
          properties: {
            icon: 'end-point-icon',
            iconSize: 0.13, // Adjust as needed
          },
          geometry: {
            type: 'Point',
            coordinates: locationDetails.endPoint,
          },
        },
      ],
    };
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.mapContainer}>
          {locationDetails ? (
            <Mapbox.MapView
              style={styles.map}
              onDidFinishLoadingMap={() => {
                if (cameraBounds) {
                  // Optionally, adjust camera here if needed
                }
              }}>
              <Mapbox.Camera
                bounds={
                  cameraBounds
                    ? {
                        ne: cameraBounds.ne,
                        sw: cameraBounds.sw,
                        paddingLeft: 50,
                        paddingRight: 50,
                        paddingTop: 50,
                        paddingBottom: 50,
                      }
                    : null
                }
              />

              <Mapbox.Images
                images={{
                  'start-point-icon': startMarker,
                  'end-point-icon': endMarker,
                }}
              />

              {/* Add Markers */}
              {markers && (
                <Mapbox.ShapeSource id="markerSource" shape={markers}>
                  <Mapbox.SymbolLayer
                    id="markerLayer"
                    style={{
                      iconImage: ['get', 'icon'],
                      iconSize: ['get', 'iconSize'],
                      iconAllowOverlap: true,
                      iconAnchor: 'bottom',
                      iconOffset: [0, -10],
                    }}
                  />
                </Mapbox.ShapeSource>
              )}

              {/* Add Route Line */}
              {routeData && (
                <Mapbox.ShapeSource id="routeSource" shape={routeData}>
                  <Mapbox.LineLayer id="routeLine" style={styles.routeLine} />
                </Mapbox.ShapeSource>
              )}
            </Mapbox.MapView>
          ) : (
            <View style={styles.loadingContainer}>
              <Text>Loading Map...</Text>
            </View>
          )}
        </View>
        {/* Details Container */}
        <View style={styles.detailsContainer}>
          <View style={styles.minimumChargesContainer}>
            <Text style={styles.serviceFare}>Commander on the way</Text>
          </View>

          <View style={styles.firstContainer}>
            <View>
              {/* Service Location */}
              <View style={styles.locationContainer}>
                <Image
                  source={{
                    uri: 'https://i.postimg.cc/qvJw8Kzy/Screenshot-2024-11-13-170828-removebg-preview.png',
                  }}
                  style={styles.locationPinImage}
                />
                <View style={styles.locationDetails}>
                  <Text style={styles.locationAddress}>
                    {addressDetails.area}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Service Type */}
          <View style={styles.serviceDetails}>
            <View>
              <View>
                <Text style={styles.serviceType}>Service</Text>
                <View style={{position: 'relative'}}>
                  {showUpArrowService && (
                    <View style={styles.arrowUpContainer}>
                      <Entypo name="chevron-small-up" size={20} color="#9e9e9e" />
                    </View>
                  )}

                  <ScrollView
                    style={styles.servicesNamesContainer}
                    contentContainerStyle={styles.servicesNamesContent}
                    onScroll={handleServiceScroll}
                    scrollEventThrottle={16}>
                    {serviceArray.map((serviceItem, index) => (
                      <View key={index} style={styles.serviceItem}>
                        <Text style={styles.serviceText}>
                          {serviceItem.serviceName}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>

                  {showDownArrowService && (
                    <View style={styles.arrowDownContainer}>
                      <Entypo
                        name="chevron-small-down"
                        size={20}
                        color="#9e9e9e"
                      />
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.pinContainer}>
                <Text style={styles.pinText}>PIN</Text>

                {/* Display each pin digit in its own box */}
                <View style={styles.pinBoxesContainer}>
                  {pin.split('').map((digit, index) => (
                    <View key={index} style={styles.pinBox}>
                      <Text style={styles.pinNumber}>{digit}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancelModal}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>

              {/* Modal for Cancellation Reasons */}
              <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={closeModal}>
                <View style={styles.modalOverlay}>
                  <TouchableOpacity
                    onPress={closeModal}
                    style={styles.backButtonContainer}>
                    <AntDesign name="arrowleft" size={20} color="black" />
                  </TouchableOpacity>

                  <View style={styles.modalContainer}>
                    {/* Title and Subtitle */}
                    <Text style={styles.modalTitle}>
                      What is the reason for your cancellation?
                    </Text>
                    <Text style={styles.modalSubtitle}>
                      Could you let us know why you're canceling?
                    </Text>

                    {/* Cancellation Reasons */}
                    <TouchableOpacity
                      style={styles.reasonButton}
                      onPress={openConfirmationModal}>
                      <Text style={styles.reasonText}>Found a better price</Text>
                      <AntDesign name="right" size={16} color="#4a4a4a" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reasonButton}
                      onPress={openConfirmationModal}>
                      <Text style={styles.reasonText}>Wrong work location</Text>
                      <AntDesign name="right" size={16} color="#4a4a4a" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reasonButton}
                      onPress={openConfirmationModal}>
                      <Text style={styles.reasonText}>Wrong service booked</Text>
                      <AntDesign name="right" size={16} color="#4a4a4a" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reasonButton}
                      onPress={openConfirmationModal}>
                      <Text style={styles.reasonText}>
                        More time to assign a commander
                      </Text>
                      <AntDesign name="right" size={16} color="#4a4a4a" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reasonButton}
                      onPress={openConfirmationModal}>
                      <Text style={styles.reasonText}>Others</Text>
                      <AntDesign name="right" size={16} color="#4a4a4a" />
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>

              {/* Confirmation Modal */}
              <Modal
                animationType="slide"
                transparent={true}
                visible={confirmationModalVisible}
                onRequestClose={closeConfirmationModal}>
                <View style={styles.modalOverlay}>
                  <View style={styles.crossContainer}>
                    <TouchableOpacity
                      onPress={closeConfirmationModal}
                      style={styles.backButtonContainer}>
                      <Entypo name="cross" size={20} color="black" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.confirmationModalContainer}>
                    <Text style={styles.confirmationTitle}>
                      Are you sure you want to cancel this Service?
                    </Text>
                    <Text style={styles.confirmationSubtitle}>
                      Please avoid canceling – we’re working to connect you with
                      the best expert to solve your problem.
                    </Text>

                    <TouchableOpacity
                      style={styles.confirmButton}
                      onPress={handleCancelBooking}>
                      <Text style={styles.confirmButtonText}>
                        Cancel my service
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            </View>

            {/* Worker Details */}
            <View style={styles.workerDetailsContainer}>
              <View>
                {addressDetails.profile && (
                  <Image
                    source={{uri: addressDetails.profile}}
                    style={styles.image}
                  />
                )}
                <Text style={styles.workerName}>{addressDetails.name}</Text>
              </View>
              <View style={styles.iconsContainer}>
                <TouchableOpacity style={styles.actionButton}>
                  <MaterialIcons name="call" size={18} color="#FF5722" />
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionButton}>
                  <AntDesign name="message1" size={18} color="#FF5722" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const bottomCardHeight = 330;

const screenHeight = Dimensions.get('window').height;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1, // Ensure it takes up the remaining space
  },
  map: {
    flex: 1,
  },
  markerImage: {
    width: 26, // Adjust size as needed
    height: 50, // Adjust size as needed
    resizeMode: 'contain',
  },
  serviceText: {
    color: '#212121',
    fontWeight: 'bold',
    fontSize: 14,
    marginTop: 5,
  },
  servicesNamesContainer: {
    width: '90%',
    maxHeight: 60, // Adjust the height based on how many items you expect to show
    // Remove layout properties like flexDirection and alignItems here
  },
  servicesNamesContent: {
    // Default is column, but you can add spacing if desired:
    flexDirection: 'column',
    paddingVertical: 10,
  },
  arrowUpContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    zIndex: 1,
  },
  arrowDownContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    zIndex: 1,
  },
  firstContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  workerName: {
    color: '#212121',
    textAlign: 'center',
  },
  image: {
    width: 60,
    height: 60,
    borderRadius: 50,
  },
  serviceName: {
    color: '#212121',
  },
  iconsContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  locationPinImage: {
    width: 20,
    height: 20,
    marginRight: 10,
  },
  serviceDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '95%',
    alignItems: 'center',
  },
  minimumChargesContainer: {
    height: 46,
    backgroundColor: '#f6f6f6',
    borderRadius: 32,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 10,
  },
  loadingContainer: {
    flex: 1,
    // minHeight: 0.4 * screenHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeLine: {
    lineColor: '#212121',
    lineWidth: 3,
  },
  cancelButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 1,
    width: 80,
    height: 35,
  },
  cancelText: {
    fontSize: 13,
    color: '#4a4a4a',
    fontWeight: 'bold',
  },
  pinContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingVertical: 10,
  },
  pinText: {
    color: '#9e9e9e',
    fontSize: 18,
    paddingTop: 10,
  },
  pinBoxesContainer: {
    flexDirection: 'row',
    gap: 5,
  },
  pinBox: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#212121',
    borderRadius: 5,
  },
  pinNumber: {
    color: '#212121',
    fontSize: 14,
  },
  detailsContainer: {
    height: bottomCardHeight, // Fixed height
    backgroundColor: '#ffffff',
    padding: 15,
    paddingHorizontal: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  serviceFare: {
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
    fontSize: 16,
    color: '#1D2951',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
    width: '90%',
  },
  locationDetails: {
    marginLeft: 10,
  },
  locationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  locationAddress: {
    fontSize: 13,
    color: '#212121',
  },
  workerDetailsContainer: {
    flexDirection: 'column',
    gap: 5,
    alignItems: 'center',
  },
  serviceType: {
    fontSize: 16,
    marginTop: 10,
    color: '#9e9e9e',
  },
  actionButton: {
    backgroundColor: '#EFDCCB',
    height: 35,
    width: 35,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrivalButton: {
    backgroundColor: '#FF5722',
    borderRadius: 5,
    padding: 15,
    alignItems: 'center',
    marginTop: 20,
    marginHorizontal: 25,
  },
  arrivalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  backButtonContainer: {
    width: 40,
    height: 40,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderRadius: 50,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    zIndex: 1,
    marginHorizontal: 10,
    marginBottom: 5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 30,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
    color: '#000',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
  },
  reasonButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  reasonText: {
    fontSize: 16,
    color: '#333',
  },
  closeButton: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#ddd',
    borderRadius: 5,
  },
  closeText: {
    fontSize: 16,
    color: '#555',
  },
  crossContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  confirmationModalContainer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 40,
    paddingBottom: 30,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  confirmationTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingBottom: 10,
    marginBottom: 5,
    color: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  confirmationSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    paddingBottom: 10,
    paddingTop: 10,
  },
  confirmButton: {
    backgroundColor: '#FF4500',
    borderRadius: 40,
    paddingVertical: 15,
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default Navigation;
