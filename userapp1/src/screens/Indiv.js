import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  BackHandler,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  CommonActions,
  useFocusEffect,
} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import axios from 'axios';
import uuid from 'react-native-uuid';
import EncryptedStorage from 'react-native-encrypted-storage';
import LottieView from 'lottie-react-native'; // Import LottieView
import PushNotification from 'react-native-push-notification';
// import Config from 'react-native-config';

const PaintingServices = () => {
  const navigation = useNavigation();
  const [subservice, setSubServices] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true); // Track loading state
  const route = useRoute();

  useEffect(() => {
    if (route.params) {
      setName(route.params.serviceObject);
      fetchServices(route.params.serviceObject);
    }
  }, [route.params]);

  // Handle back button press
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

  const fetchServices = useCallback(async serviceObject => {
    setLoading(true);
    try {
      const response = await axios.post(
        `https://backend.clicksolver.com/api/individual/service`,
        {
          serviceObject: serviceObject,
        },
      );
      const servicesWithIds = response.data.map(service => ({
        ...service,
        id: uuid.v4(),
      }));
      setSubServices(servicesWithIds);
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleBookCommander = useCallback(async serviceId => {
    try {
      // Check if notifications are enabled
      PushNotification.checkPermissions(permissions => {
        if (!permissions.alert) {
          // If notifications are not enabled, prompt the user to go to settings
          Alert.alert(
            'Notifications Required',
            'You need to enable notifications to proceed. Go to app settings to enable them.',
            [
              {
                text: 'Cancel',
                onPress: () => console.log('Notification permission denied'),
                style: 'cancel',
              },
              {
                text: 'Open Settings',
                onPress: () => {
                  if (Platform.OS === 'ios') {
                    Linking.openURL('app-settings:');
                  } else {
                    Linking.openSettings();
                  }
                },
              },
            ],
            {cancelable: false},
          );
        } else {
          proceedToBookCommander(serviceId);
        }
      });
    } catch (error) {
      console.error('Error checking notification permissions:', error);
    }
  }, []);

  const proceedToBookCommander = useCallback(
    async serviceId => {
      // try {
      //   const cs_token = await EncryptedStorage.getItem('cs_token');
      //   if (cs_token) {
      //     const response = await axios.get(
      //       `https://backend.clicksolver.com/api/user/track/details`,
      //       {
      //         headers: {Authorization: `Bearer ${cs_token}`},
      //       },
      //     );

      //     const track = response?.data?.track || [];
      //     const isTracking = track.some(
      //       item => item.serviceBooked === serviceId,
      //     );
      //     if (isTracking) {
      //       Alert.alert('Already in tracking');
      //     } else {
      //       navigation.push('ServiceBooking', {
      //         serviceName: serviceId,
      //       });
      //     }
      //   }
      // } catch (error) {
      //   console.error('Error fetching track details:', error);
      // }
      navigation.push('ServiceBooking', {
        serviceName: serviceId,
      });
    },
    [navigation],
  );

  const handleBack = useCallback(() => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{name: 'Tabs', state: {routes: [{name: 'Home'}]}}],
      }),
    );
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack}>
          <FontAwesome6 name="arrow-left-long" size={20} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{name}</Text>
      </View>

      <View style={styles.banner}>
        <View style={styles.bannerText}>
          <View style={styles.bannerDetails}>
            <Text style={styles.bannerPrice}>Just 149/-</Text>
            <Text style={styles.bannerDescription}>{name}</Text>
            <Text style={styles.bannerInfo}>
              Minimum charges for first half and hour
            </Text>
          </View>
        </View>
        <Image
          source={{
            uri: 'https://i.postimg.cc/nLSx6CFs/ec25d95ccdd81fad0f55cc8d83a8222e.png',
          }}
          style={styles.bannerImage}
        />
      </View>

      {/* Loading Animation */}
      {loading && (
        <LottieView
          source={require('../assets/cardsLoading.json')} // Path to your Lottie JSON file
          autoPlay
          loop
          style={styles.loadingAnimation}
        />
      )}

      {/* Services */}
      <ScrollView style={styles.services}>
        {subservice.map(service => (
          <ServiceItem
            key={service.id}
            title={service.service_name}
            imageUrl={service.service_urls}
            handleBookCommander={handleBookCommander}
            serviceId={service.service_name}
          />
        ))}
      </ScrollView>
    </View>
  );
};

const ServiceItem = React.memo(
  ({title, imageUrl, handleBookCommander, serviceId}) => (
    <View style={styles.serviceItem}>
      <View style={styles.serviceImageContainer}>
        <Image
          source={{uri: imageUrl}}
          style={styles.serviceImage}
          resizeMode="stretch"
        />
      </View>
      <View style={styles.serviceInfo}>
        <Text style={styles.serviceTitle}>{title}</Text>
        <TouchableOpacity
          style={styles.bookNow}
          onPress={() => handleBookCommander(serviceId)}>
          <Text style={styles.bookNowText}>Book Now ➔</Text>
        </TouchableOpacity>
      </View>
    </View>
  ),
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
  },
  headerTitle: {
    fontSize: 20,
    marginLeft: 10,
    color: '#1D2951',
    fontFamily: 'RobotoSlab-Bold',
    lineHeight: 23.44,
  },
  loadingAnimation: {
    width: '100%',
    height: '100%',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF4E6',
    borderRadius: 15,
    marginVertical: 10,
    marginBottom: 30,
  },
  bannerText: {
    flex: 1,
    padding: 15,
  },
  bannerPrice: {
    color: '#ff4500',
    fontSize: 25,
    fontFamily: 'RobotoSlab-Bold',
    lineHeight: 34,
  },
  bannerDescription: {
    color: '#808080',
    fontSize: 14,
    marginTop: 5,
    fontFamily: 'NotoSerif-SemiBold',
    lineHeight: 16.41,
  },
  bannerInfo: {
    color: '#808080',
    fontFamily: 'RobotoSlab-Regular',
    opacity: 0.8,
    fontSize: 12,
    marginTop: 5,
    lineHeight: 14.06,
  },
  bannerImage: {
    width: 100,
    height: 100,
    resizeMode: 'cover',
    transform: [{rotate: '0deg'}],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 200,
  },
  services: {
    flex: 1,
  },
  serviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  serviceImage: {
    width: 165,
    height: 105,
    borderRadius: 10,
  },
  serviceInfo: {
    flex: 1,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  serviceTitle: {
    fontSize: 16,
    fontFamily: 'RobotoSlab-Bold',
    color: '#333',
  },
  bookNow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF4500',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 15,
    marginTop: 10,
    width: 110,
    height: 32,
    opacity: 0.88,
    elevation: 5,
  },
  bookNowText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13,
    textAlign: 'center',
  },
});

export default PaintingServices;
