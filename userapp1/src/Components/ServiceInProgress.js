import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  BackHandler,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import LottieView from 'lottie-react-native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import EncryptedStorage from 'react-native-encrypted-storage';
import {
  useNavigation,
  useRoute,
  CommonActions,
  useFocusEffect,
} from '@react-navigation/native';
import axios from 'axios';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

const ServiceInProgressScreen = () => {
  const [details, setDetails] = useState({});
  const [services, setServices] = useState([]);
  const [decodedId, setDecodedId] = useState(null);

  const route = useRoute();
  const {encodedId} = route.params;
  const navigation = useNavigation();

  useEffect(() => {
    if (encodedId) {
      setDecodedId(atob(encodedId));
    }
  }, [encodedId]);

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const response = await axios.post(
          `${process.env.BACKENDAIPE}/api/user/work/progress/details`,
          {
            decodedId,
          },
        );
        const data = response.data[0];
        setDetails(data);

        // Map `service_booked` and `service_status` to `services`
        const mappedServices = data.service_booked.map(serviceBookedItem => {
          const serviceStatusItem = data.service_status.find(
            statusItem =>
              statusItem.serviceName === serviceBookedItem.serviceName,
          );

          return {
            id: serviceBookedItem.main_service_id,
            name: serviceBookedItem.serviceName,
            quantity: serviceBookedItem.quantity,
            image:
              serviceBookedItem.url ||
              'https://i.postimg.cc/6Tsbn3S6/Image-8.png',
            status: {
              accept: serviceStatusItem.accept || null,
              arrived: serviceStatusItem.arrived || null,
              workCompleted: serviceStatusItem.workCompleted || null,
            },
          };
        });

        setServices(mappedServices);
      } catch (error) {
        console.error('Error fetching bookings data:', error);
      }
    };

    if (decodedId) {
      fetchBookings();
    }
  }, [decodedId]);

  // Function to generate timeline data
  const generateTimelineData = status => {
    const statusKeys = ['accept', 'arrived', 'workCompleted'];
    const statusDisplayNames = {
      accept: 'In Progress',
      arrived: 'Work Started',
      workCompleted: 'Work Completed',
    };
    return statusKeys.map(statusKey => ({
      key: statusKey,
      title: statusDisplayNames[statusKey],
      time: status[statusKey] || null,
      iconColor: status[statusKey] ? '#ff4500' : '#a1a1a1',
      lineColor: status[statusKey] ? '#ff4500' : '#a1a1a1',
    }));
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

  const handleCompleteClick = async () => {
    if (decodedId) {
      try {
        const response = await axios.post(
          `${process.env.BACKENDAIPE}/api/work/time/completed/request`,
          {
            notification_id: decodedId,
          },
        );

        if (response.status === 200) {
          setShowMessage(true);
          await EncryptedStorage.setItem('messageBox', JSON.stringify(true));
          setTimeLeft(60);
          setIsWaiting(true);
        }
      } catch (error) {
        console.error('Error completing work:', error);
      }
    }
  };

  const formatDate = dateString => {
    const date = new Date(dateString);
    const options = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    };
    return date.toLocaleString('en-US', options);
  };

  return (
    <View style={styles.mainContainer}>
      <View style={styles.headerContainer}>
        <FontAwesome6
          name="arrow-left-long"
          size={20}
          color="#212121"
          style={styles.leftIcon}
        />
        <Text style={styles.headerText}>Service In Progress</Text>
      </View>
      <ScrollView style={styles.container}>
        <View style={styles.profileContainer}>
          <View style={styles.technicianContainer}>
            <Image
              source={{
                uri:
                  details.profile ||
                  'https://i.postimg.cc/mZnDzdqJ/IMG-20240929-WA0024.jpg',
              }}
              style={styles.technicianImage}
            />
            <View style={styles.technicianDetails}>
              <Text style={styles.technicianName}>{details.name}</Text>
              <Text style={styles.technicianTitle}>Certified Technician</Text>
            </View>
          </View>
          <Text style={styles.estimatedCompletion}>
            Estimated Completion: 2 hours
          </Text>
          <Text style={styles.statusText}>
            Status: Working on your{' '}
            {services.map(service => service.name).join(', ')} to ensure optimal
            performance.
          </Text>
        </View>
        <View style={styles.houseImageContainer}>
          <LottieView
            source={require('../assets/serviceLoading.json')}
            autoPlay
            loop
            style={styles.loadingAnimation}
          />
        </View>

        <TouchableOpacity style={styles.button} onPress={handleCompleteClick}>
          <Text style={styles.buttonText}>Service Completed</Text>
        </TouchableOpacity>

        <View style={styles.serviceDetailsContainer}>
          <View style={styles.serviceDetailsHeaderContainer}>
            <Text style={styles.serviceDetailsTitle}>Service Details</Text>
            <TouchableOpacity>
              <Icon name="keyboard-arrow-right" size={24} color="#ff4500" />
            </TouchableOpacity>
          </View>
          <View style={styles.iconDetailsContainer}>
            <View style={styles.detailsRow}>
              <Icon name="calendar-today" size={20} color="#ff4500" />
              <Text style={styles.detailText}>
                Work started{' '}
                <Text style={styles.highLightText}>
                  {formatDate(details.created_at)}
                </Text>
              </Text>
            </View>
            <View style={styles.detailsRow}>
              <Icon name="location-on" size={20} color="#ff4500" />
              <Text style={styles.detailText}>
                Location:{' '}
                <Text style={styles.highLightText}>{details.area}</Text>
              </Text>
            </View>
          </View>
          <View>
            <View style={{marginTop: 20}}>
              {services.map((service, index) => {
                const timelineData = generateTimelineData(service.status);
                return (
                  <View style={styles.ServiceCardsContainer} key={index}>
                    <View style={styles.technicianContainer}>
                      <Image
                        source={{
                          uri: service.image,
                        }}
                        style={styles.technicianImage}
                      />
                      <View style={styles.technicianDetails}>
                        <Text style={styles.technicianName}>
                          {service.name}
                        </Text>
                        <Text style={styles.technicianTitle}>
                          Quantity: {service.quantity}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.statusText}>
                      Service Status:{' '}
                      <Text style={styles.highLightText}>
                        {timelineData.find(item => item.time)?.title ||
                          'Pending'}
                      </Text>
                    </Text>
                    <Text style={styles.statusText}>
                      Estimated Completion:{' '}
                      <Text style={styles.highLightText}>2 hours</Text>
                    </Text>

                    {/* Timeline Section */}
                    <View style={styles.sectionContainer}>
                      <View style={styles.serviceTimeLineContainer}>
                        <Text style={styles.sectionTitle}>
                          Service Timeline
                        </Text>
                      </View>
                      <View style={styles.innerContainerLine}>
                        {timelineData.map((item, idx) => (
                          <View key={item.key} style={styles.timelineItem}>
                            <View style={styles.iconAndLineContainer}>
                              <MaterialCommunityIcons
                                name="circle"
                                size={14}
                                color={item.iconColor}
                              />
                              {idx !== timelineData.length - 1 && (
                                <View
                                  style={[
                                    styles.lineSegment,
                                    {
                                      backgroundColor:
                                        timelineData[idx + 1].iconColor,
                                    },
                                  ]}
                                />
                              )}
                            </View>
                            <View style={styles.timelineContent}>
                              <View style={styles.timelineTextContainer}>
                                <Text style={styles.timelineText}>
                                  {item.title}
                                </Text>
                                <Text style={styles.timelineTime}>
                                  {item.time
                                    ? formatDate(item.time)
                                    : 'Pending'}
                                </Text>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  headerContainer: {
    backgroundColor: '#ffffff',
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    elevation: 1,
    shadowRadius: 4,
    zIndex: 1,
  },
  leftIcon: {
    position: 'absolute',
    top: 15,
    left: 10,
  },
  headerText: {
    color: '#212121',
    fontSize: 18,
    fontWeight: 'bold',
  },
  profileContainer: {
    flexDirection: 'column',
    backgroundColor: '#fff',
    padding: 20,
    marginVertical: 10,
    marginHorizontal: 20,
    borderRadius: 10,
    elevation: 1,
  },
  loadingAnimation: {
    width: '100%',
    height: 200,
  },
  ServiceCardsContainer: {
    flexDirection: 'column',
    marginVertical: 10,
    backgroundColor: '#f9f9f9',
    padding: 15,
    borderRadius: 10,
    elevation: 2,
  },
  technicianContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  technicianImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  technicianDetails: {
    marginLeft: 15,
    flex: 1,
  },
  technicianName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  technicianTitle: {
    color: '#4a4a4a',
  },
  estimatedCompletion: {
    color: '#212121',
    fontWeight: '500',
    marginTop: 5,
  },
  statusText: {
    color: '#4a4a4a',
    marginTop: 5,
  },
  houseImageContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  button: {
    backgroundColor: '#ff4500',
    paddingVertical: 10,
    marginHorizontal: 20,
    borderRadius: 25,
    alignItems: 'center',
    marginHorizontal: '20%',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  serviceDetailsContainer: {
    flexDirection: 'column',
    backgroundColor: '#fff',
    padding: 20,
    marginTop: 20,
    marginHorizontal: 20,
    borderRadius: 10,
    elevation: 3,
    marginBottom: 10,
  },
  serviceDetailsHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serviceDetailsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  iconDetailsContainer: {
    marginVertical: 10,
    gap: 5,
    flexDirection: 'column',
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    marginLeft: 10,
    color: '#4a4a4a',
  },
  highLightText: {
    fontWeight: 'bold',
  },
  sectionContainer: {
    marginBottom: 16,
    paddingLeft: 16,
    paddingRight: 16,
    width: '95%',
    marginTop: 10,
  },
  serviceTimeLineContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#212121',
  },
  innerContainerLine: {
    marginTop: 5,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconAndLineContainer: {
    alignItems: 'center',
    width: 20,
  },
  lineSegment: {
    width: 2,
    height: 35,
    marginTop: 2,
  },
  timelineContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginLeft: 10,
  },
  timelineTextContainer: {
    flex: 1,
  },
  timelineText: {
    fontSize: 14,
    color: '#212121',
    fontWeight: 'bold',
  },
  timelineTime: {
    fontSize: 10,
    color: '#4a4a4a',
  },
});

export default ServiceInProgressScreen;