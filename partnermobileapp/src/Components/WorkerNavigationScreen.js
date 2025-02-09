import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  View,
  StyleSheet,
  Text,
  Alert,
  Image,
  BackHandler,
  Linking,
  Platform,
  Animated,
  PermissionsAndroid,
  TouchableOpacity,
  Easing,
  Dimensions,
  Modal,
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
import Geolocation from '@react-native-community/geolocation';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import SwipeButton from 'rn-swipe-button';
import Entypo from 'react-native-vector-icons/Entypo';

// Set your Mapbox access token here
Mapbox.setAccessToken(
  'pk.eyJ1IjoieWFzd2FudGh2YW5hbWEiLCJhIjoiY20ybTMxdGh3MGZ6YTJxc2Zyd2twaWp2ZCJ9.uG0mVTipkeGVwKR49iJTbw',
);
const startMarker = require('./assets/start-marker.png');
const endMarker = require('./assets/end-marker.png');

const WorkerNavigationScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const [cameraBounds, setCameraBounds] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [locationDetails, setLocationDetails] = useState({
    startPoint: [80.519353, 16.987142],
    endPoint: [80.6093701, 17.1098751],
  });
  const [decodedId, setDecodedId] = useState(null);
  const [addressDetails, setAddressDetails] = useState(null);
  const [titleColor, setTitleColor] = useState('#FFFFFF');
  const [swiped, setSwiped] = useState(false);
  const [reasonModalVisible, setReasonModalVisible] = useState(false);
  const [confirmationModalVisible, setConfirmationModalVisible] =
    useState(false);
  const [showUpArrowService, setShowUpArrowService] = useState(false);
  const [showDownArrowService, setShowDownArrowService] = useState(false);
  const [serviceArray, setServiceArray] = useState([]);

  const handleServiceScroll = event => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const containerHeight = event.nativeEvent.layoutMeasurement.height;
    const contentHeight = event.nativeEvent.contentSize.height;

    setShowUpArrowService(offsetY > 0);
    setShowDownArrowService(offsetY + containerHeight < contentHeight);
  };

  useEffect(() => {
    const {encodedId} = route.params;
    if (encodedId) {
      try {
        setDecodedId(atob(encodedId));
      } catch (error) {
        console.error('Error decoding Base64:', error);
      }
    }
  }, [route.params]);

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

  useEffect(() => {
    if (decodedId) {
      checkCancellationStatus();
      fetchAddressDetails();
      fetchLocationDetails();
    }
  }, [decodedId]);

  const checkCancellationStatus = async () => {
    try {
      const response = await axios.get(
        `https://backend.clicksolver.com/api/worker/cancelled/status`,
        {
          params: {notification_id: decodedId},
        },
      );

      if (response.data.notificationStatus === 'usercanceled') {
        const pcs_token = await EncryptedStorage.getItem('pcs_token');
        await axios.post(
          `https://backend.clicksolver.com/api/worker/action`,
          {
            encodedId: '',
            screen: '',
          },
          {
            headers: {Authorization: `Bearer ${pcs_token}`},
          },
        );

        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{name: 'Tabs', state: {routes: [{name: 'Home'}]}}],
          }),
        );
      }
    } catch (error) {
      console.error('Error checking cancellation status:', error);
    }
  };

  const ThumbIcon = () => {
    return (
      <View style={styles.thumbContainer}>
        <Text>
          {swiped ? (
            <Entypo
              name="check"
              size={20}
              color="#ff4500"
              style={styles.checkIcon}
            />
          ) : (
            <FontAwesome6 name="arrow-right-long" size={18} color="#ff4500" />
          )}
        </Text>
      </View>
    );
  };

  const fetchAddressDetails = useCallback(async () => {
    try {
      const response = await axios.get(
        `https://backend.clicksolver.com/api/user/address/details`,
        {
          params: {notification_id: decodedId},
        },
      );
      setAddressDetails(response.data);
      setServiceArray(response.data.service_booked);
    } catch (error) {
      console.error('Error fetching address details:', error);
    }
  }, [decodedId]);

  const fetchLocationDetails = async () => {
    try {
      const response = await axios.post(
        `https://backend.clicksolver.com/api/service/location/navigation`,
        {
          notification_id: decodedId,
        },
      );

      const {startPoint, endPoint} = response.data;
      setLocationDetails({
        startPoint: startPoint.map(coord => parseFloat(coord)),
        endPoint: endPoint.map(coord => parseFloat(coord)),
      });
    } catch (error) {
      console.error('Error fetching location details:', error);
    }
  };

  const handleCancelBooking = async () => {
    setConfirmationModalVisible(false);
    setReasonModalVisible(false);

    try {
      const response = await axios.post(
        `https://backend.clicksolver.com/api/worker/work/cancel`,
        {notification_id: decodedId},
      );

      console.log(response);
      if (response.status === 200) {
        const pcs_token = await EncryptedStorage.getItem('pcs_token');

        if (!pcs_token) {
          Alert.alert('Error', 'User token not found.');
          return;
        }

        // Send data to the backend
        await axios.post(
          `https://backend.clicksolver.com/api/worker/action`,
          {
            encodedId: '',
            screen: '',
          },
          {
            headers: {
              Authorization: `Bearer ${pcs_token}`,
            },
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
  };

  useEffect(() => {
    if (locationDetails.startPoint && locationDetails.endPoint) {
      const fetchRoute = async () => {
        try {
          const response = await axios.get(
            `https://api.mapbox.com/directions/v5/mapbox/driving/${locationDetails.startPoint.join(
              ',',
            )};${locationDetails.endPoint.join(
              ',',
            )}?alternatives=true&steps=true&geometries=geojson&access_token=pk.eyJ1IjoieWFzd2FudGh2YW5hbWEiLCJhIjoiY20ybTMxdGh3MGZ6YTJxc2Zyd2twaWp2ZCJ9.uG0mVTipkeGVwKR49iJTbw`,
          );

          if (response.data.routes.length > 0) {
            setRouteData(response.data.routes[0].geometry);
          } else {
            console.error('No routes found in the response.');
          }
        } catch (error) {
          console.error('Error fetching route:', error);
        }
      };
      fetchRoute();
    }
  }, [locationDetails]);

  const handleLocationReached = () => {
    const encodedNotificationId = btoa(decodedId);
    navigation.push('OtpVerification', {encodedId: encodedNotificationId});
  };

  const handleCancelModal = () => {
    setReasonModalVisible(true);
  };

  const closeReasonModal = () => {
    setReasonModalVisible(false);
  };

  const openConfirmationModal = () => {
    setConfirmationModalVisible(true);
  };

  const closeConfirmationModal = () => {
    setConfirmationModalVisible(false);
  };

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

  const openGoogleMaps = () => {
    Geolocation.getCurrentPosition(
      position => {
        const {latitude, longitude} = position.coords;
        const url = `https://www.google.com/maps/dir/?api=1&origin=${latitude},${longitude}&destination=${locationDetails.endPoint[1]},${locationDetails.endPoint[0]}&travelmode=driving`;
        Linking.openURL(url).catch(err =>
          console.error('Error opening Google Maps:', err),
        );
      },
      error => {
        console.error('Error getting current location:', error);
      },
    );
  };

  let markers = null;
  if (locationDetails) {
    markers = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            icon: 'start-point-icon',
            iconSize: 0.2, // Adjust size as needed
          },
          geometry: {
            type: 'Point',
            coordinates: locationDetails.startPoint,
          },
        },
        {
          type: 'Feature',
          properties: {
            icon: 'end-point-icon',
            iconSize: 0.13, // Adjust size as needed
          },
          geometry: {
            type: 'Point',
            coordinates: locationDetails.endPoint,
          },
        },
      ],
    };
  }

  // Compute bounding box
  useEffect(() => {
    if (locationDetails && routeData && routeData.coordinates) {
      const allCoordinates = [
        locationDetails.startPoint,
        locationDetails.endPoint,
        ...routeData.coordinates,
      ];

      const bounds = computeBoundingBox(allCoordinates);
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

  return (
    <View style={styles.container}>
     <View style={styles.mapContainer}>
      <Mapbox.MapView style={styles.map}>
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

        {/* Add Images to Map */}
        <Mapbox.Images
          images={{
            'start-point-icon': require('../../assets/start-marker.png'),
            'end-point-icon': require('../../assets/end-marker.png'),
          }}
        />

        {/* Render Markers */}
        {markers && (
          <Mapbox.ShapeSource id="markerSource" shape={markers}>
            <Mapbox.SymbolLayer
              id="markerLayer"
              style={{
                iconImage: ['get', 'icon'],
                iconSize: ['get', 'iconSize'], // Use iconSize from properties
                iconAllowOverlap: true,
                iconAnchor: 'bottom',
                iconOffset: [0, -10], // Adjust if needed
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Render Route Line */}
        {routeData && (
          <Mapbox.ShapeSource
            id="routeSource"
            shape={{
              type: 'Feature',
              geometry: routeData,
            }}>
            <Mapbox.LineLayer id="routeLine" style={styles.routeLine} />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>
      </View>
      <TouchableOpacity style={styles.cancelButton} onPress={handleCancelModal}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.googleMapsButton}
        onPress={openGoogleMaps}>
        <Text style={styles.googleMapsText}>Google Maps</Text>
        <MaterialCommunityIcons
          name="navigation-variant"
          size={20}
          color="#C1C1C1"
        />
      </TouchableOpacity>
      {/* Reason Selection Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={reasonModalVisible}
        onRequestClose={closeReasonModal}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            onPress={closeReasonModal}
            style={styles.backButtonContainer}>
            <AntDesign name="arrowleft" size={20} color="black" />
          </TouchableOpacity>

          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>
              What is the reason for your cancellation?
            </Text>
            <Text style={styles.modalSubtitle}>
              Could you let us know why you're canceling?
            </Text>

            <TouchableOpacity
              style={styles.reasonButton}
              onPress={openConfirmationModal}>
              <Text style={styles.reasonText}>Accidentally clicked</Text>
              <AntDesign name="right" size={16} color="#4a4a4a" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.reasonButton}
              onPress={openConfirmationModal}>
              <Text style={styles.reasonText}>Health Issue</Text>
              <AntDesign name="right" size={16} color="#4a4a4a" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.reasonButton}
              onPress={openConfirmationModal}>
              <Text style={styles.reasonText}>Another Work get</Text>
              <AntDesign name="right" size={16} color="#4a4a4a" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.reasonButton}
              onPress={openConfirmationModal}>
              <Text style={styles.reasonText}>Problem to my vehicle</Text>
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
              The user is waiting for your help to solve their issue. Please
              avoid clicking cancel and assist them as soon as possible
            </Text>

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleCancelBooking}>
              <Text style={styles.confirmButtonText}>Cancel my service</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {addressDetails && (
        <View style={styles.detailsContainer}>
          <View style={styles.minimumChargesContainer}>
            <Text style={styles.serviceFare}>
            Safety: <Text style={styles.amount}>Be quick, stay safe!</Text>
            </Text>
          </View>

          {/* Service Location */}
          <View style={styles.locationContainer}>
            <Image
              source={{
                uri: 'https://i.postimg.cc/qvJw8Kzy/Screenshot-2024-11-13-170828-removebg-preview.png',
              }}
              style={styles.locationPinImage}
            />
            <View style={styles.locationDetails}>
              {/* <Text style={styles.locationTitle}>{addressDetails.city}</Text> */}
              <Text style={styles.locationAddress}>{addressDetails.area}</Text>
            </View>
          </View>

          {/* Service Type */}
          <View style={styles.serviceDetails}>
            <View>
              <Text style={styles.serviceType}>Service</Text>
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
                <Entypo name="chevron-small-down" size={20} color="#9e9e9e" />
              </View>
            )}
          </View>
          <Text style={styles.pickupText}>You are at pickup location</Text>

          {/* Arrival Button */}
          <View style={{paddingTop: 10}}>
            <SwipeButton
              title="I've Arrived"
              titleStyles={{color: titleColor}}
              railBackgroundColor="#FF5722"
              railBorderColor="#FF5722"
              railStyles={{
                borderRadius: 25,
                height: 50,
                backgroundColor: '#FF572200',
                borderColor: '#FF572200',
              }}
              thumbIconComponent={ThumbIcon}
              thumbIconBackgroundColor="#FFFFFF"
              thumbIconBorderColor="#FFFFFF"
              thumbIconWidth={50}
              thumbIconHeight={50}
              onSwipeStart={() => setTitleColor('#B0B0B0')}
              onSwipeSuccess={() => {
                handleLocationReached();
                setTitleColor('#FFFFFF');
                setSwiped(true);
              }}
              onSwipeFail={() => setTitleColor('#FFFFFF')}
            />
          </View>
        </View>
      )}
    </View>
  );
};
const bottomCardHeight = 330;
const screenHeight = Dimensions.get('window').height;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1, // Ensures it takes up the remaining height
  },
  markerImage: {
    width: 25, // Adjust size as needed
    height: 50, // Adjust size as needed
    resizeMode: 'contain',
  },
  serviceText: {
    color: '#212121',
    fontWeight: 'bold',
    fontSize: 16,
    marginTop: 5,
  },
  thumbContainer: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
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
  amount: {
    color: '#212121',
    fontSize: 16,
    fontWeight: 'bold',
  },
  serviceDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  minimumChargesContainer: {
    height: 46,
    backgroundColor: '#f6f6f6',
    borderRadius: 32,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 5,
  },
  map: {
    flex: 1,
    
  },
  routeLine: {
    lineColor: '#212121',
    lineWidth: 3,
  },
  cancelButton: {
    position: 'absolute',
    bottom: 335, // 250px from the bottom
    left: 5,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    width: 80,
    height: 35,
  },
  
  cancelText: {
    fontSize: 13,
    color: '#4a4a4a',
    fontWeight: 'bold',
  },
  googleMapsButton: {
    position: 'absolute',
    bottom: 335,
    right: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    width: 140,
    height: 40,
  },
  googleMapsText: {
    fontSize: 14,
    color: '#212121',
    fontWeight: 'bold',
  },
  detailsContainer: {
    height: bottomCardHeight, // Fixed height for the details card
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
    color: '#9e9e9e',
  },
  locationContainer: {
    flexDirection: 'row',
    width: '90%',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10,
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
    fontSize: 14,
    color: '#212121',
    fontWeight: '450',
  },
  serviceType: {
    fontSize: 16,
    marginTop: 10,
    color: '#9e9e9e',
  },
  pickupText: {
    fontSize: 16,
    color: '#212121',
    marginTop: 10,
  },
  actionButton: {
    backgroundColor: '#EFDCCB',
    height: 35,
    width: 35,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  servicesNamesContainer: {
    width: '70%',
    maxHeight: 65, // Adjust height as needed (increasing this value allows more items to be visible before scrolling)
    // DO NOT include layout properties like flexDirection or alignItems here!
  },
  servicesNamesContent: {
    flexDirection: 'column', // Ensures items are stacked vertically
  },
  serviceItem: {
    marginBottom: 5, // Add spacing between items, adjust as needed
  },
  serviceText: {
    color: '#212121',
    fontWeight: 'bold',
    fontSize: 13,
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

  backButtonContainer: {
    width: 40,
    height: 40,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center', // Distance from the left side of the screen
    backgroundColor: 'white', // Background color for the circular container
    borderRadius: 50, // Rounds the container to make it circular
    // Padding to make the icon container larger
    elevation: 5, // Elevation for shadow effect (Android)
    shadowColor: '#000', // Shadow color (iOS)
    shadowOffset: {width: 0, height: 2}, // Shadow offset (iOS)
    shadowOpacity: 0.2, // Shadow opacity (iOS)
    shadowRadius: 4, // Shadow radius (iOS)
    zIndex: 1,
    marginHorizontal: 10, // Ensures the icon is above other elements,
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
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 10,
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

export default WorkerNavigationScreen;
