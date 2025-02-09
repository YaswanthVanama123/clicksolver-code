// HelloWorld.js

import React, {useState, useEffect, useCallback} from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
Mapbox.setAccessToken(
  'pk.eyJ1IjoieWFzd2FudGh2YW5hbWEiLCJhIjoiY20ybTMxdGh3MGZ6YTJxc2Zyd2twaWp2ZCJ9.uG0mVTipkeGVwKR49iJTbw',
);
import EncryptedStorage from 'react-native-encrypted-storage';
import Entypo from 'react-native-vector-icons/Entypo';
import Octicons from 'react-native-vector-icons/Octicons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Foundation from 'react-native-vector-icons/Foundation';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  useNavigation,
  CommonActions,
  useFocusEffect,
} from '@react-navigation/native';
import axios from 'axios';
import messaging from '@react-native-firebase/messaging';
import PushNotification from 'react-native-push-notification';
import Feather from 'react-native-vector-icons/Feather';
import {Buffer} from 'buffer';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';

// Import the LocationTracker component
import LocationTracker from './LocationTracker';

const HomeScreen = () => {
  const [center, setCenter] = useState([0, 0]);
  const [workerLocation, setWorkerLocation] = useState([]);
  const screenHeight = Dimensions.get('window').height;
  const screenWidth = Dimensions.get('window').width;
  const navigation = useNavigation();
  const [notificationsArray, setNotificationsArray] = useState([]);
  const [screenName, setScreenName] = useState(null);
  const [params, setParams] = useState(null);
  const [messageBoxDisplay, setMessageBoxDisplay] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [greetingIcon, setGreetingIcon] = useState(null);
  const [showUpArrow, setShowUpArrow] = useState(false);
  const [showDownArrow, setShowDownArrow] = useState(false);

  // Function to fetch notifications and update state
  const fetchNotifications = useCallback(async () => {
    const existingNotifications = await EncryptedStorage.getItem(
      'Requestnotifications',
    );

    let notifications = existingNotifications
      ? JSON.parse(existingNotifications)
      : [];

    const currentDate = new Date();

    // Filter notifications received within the past 10 minutes
    const filteredNotifications = notifications.filter(noti => {
      const [notiDatePart, notiTimePart] = noti.receivedAt.split(', ');
      const [notiDay, notiMonth, notiYear] = notiDatePart.split('/');
      const parsedNotiReceivedAt = `${notiYear}-${notiMonth}-${notiDay}T${notiTimePart}`;
      const notiReceivedAt = new Date(parsedNotiReceivedAt);

      const timeDifferenceInMinutes =
        (currentDate - notiReceivedAt) / (1000 * 60); // milliseconds to minutes

      return timeDifferenceInMinutes <= 10;
    });

    // Update the notifications array with the filtered notifications
    notifications = filteredNotifications;

    // Update the notifications array and store locally
    setNotificationsArray(notifications);

    // Store updated notifications in local storage
    await EncryptedStorage.setItem(
      'Requestnotifications',
      JSON.stringify(notifications),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Fetch notifications when the screen gains focus
      fetchNotifications();
    }, [fetchNotifications]),
  );

  const handleScroll = event => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const containerHeight = event.nativeEvent.layoutMeasurement.height;
    const contentHeight = event.nativeEvent.contentSize.height;

    // Show up arrow if not at the top
    setShowUpArrow(offsetY > 0);

    // Show down arrow if not at the bottom
    setShowDownArrow(offsetY + containerHeight < contentHeight);
  };

  const fetchTrackDetails = async () => {
    try {
      const pcs_token = await EncryptedStorage.getItem('pcs_token');

      if (pcs_token) {
        const response = await axios.get(
          `https://backend.clicksolver.com/api/worker/track/details`,
          {
            headers: {Authorization: `Bearer ${pcs_token}`},
          },
        );

        const {route, parameter} = response.data;
        const params = JSON.parse(parameter);

        if (route) {
          setMessageBoxDisplay(true);
        } else {
          setMessageBoxDisplay(false);
        }

        setScreenName(route);
        setParams(params);
      } else {
        navigation.replace('Login');
      }
    } catch (error) {
      console.error('Error fetching track details:', error);
    }
  };

  // Function to toggle tracking
  const toggleSwitch = async () => {
    setIsEnabled(prevState => {
      const newEnabledState = !prevState;

      EncryptedStorage.setItem(
        'trackingEnabled',
        JSON.stringify(newEnabledState),
      ).catch(error => {
        console.error('Error saving enabled state:', error);
      });

      return newEnabledState;
    });
  };

  // Fetch tracking state
  const fetchTrackingState = async () => {
    try {
      const storedState = await EncryptedStorage.getItem('trackingEnabled');
      if (storedState !== null) {
        setIsEnabled(JSON.parse(storedState));
      }
    } catch (error) {
      console.error('Error fetching tracking state:', error);
    }
  };

  const earningsScreen = () => {
    navigation.push('Earnings');
  };

  const acceptRequest = async userNotificationId => {
    // Decode the notification ID if needed
    const decodedId = Buffer.from(userNotificationId, 'base64').toString(
      'ascii',
    );

    try {
      const jwtToken = await EncryptedStorage.getItem('pcs_token');
      const response = await axios.post(
        `https://backend.clicksolver.com/api/accept/request`,
        {user_notification_id: decodedId},
        {headers: {Authorization: `Bearer ${jwtToken}`}},
      );

      if (response.status === 200) {
        // After a successful request acceptance, remove the notification from state
        setNotificationsArray(prevNotifications => {
          const updatedNotifications = prevNotifications.filter(
            notif => notif.data.user_notification_id !== userNotificationId,
          );

          // Also update the locally stored notifications
          EncryptedStorage.setItem(
            'Requestnotifications',
            JSON.stringify(updatedNotifications),
          );
          return updatedNotifications;
        });

        const {notificationId} = response.data;
        const encodedNotificationId = Buffer.from(
          notificationId.toString(),
        ).toString('base64');
        const pcs_token = await EncryptedStorage.getItem('pcs_token');

        await axios.post(
          `https://backend.clicksolver.com/api/worker/action`,
          {
            encodedId: encodedNotificationId,
            screen: 'WorkerNavigation',
          },
          {headers: {Authorization: `Bearer ${pcs_token}`}},
        );

        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: 'WorkerNavigation',
                params: {encodedId: encodedNotificationId},
              },
            ],
          }),
        );
      } else {
        // Handle the error case (if needed)
        const pcs_token = await EncryptedStorage.getItem('pcs_token');

        await axios.post(
          `https://backend.clicksolver.com/api/worker/action`,
          {
            encodedId: '',
            screen: '',
          },
          {headers: {Authorization: `Bearer ${pcs_token}`}},
        );

        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{name: 'Tabs', state: {routes: [{name: 'Home'}]}}],
          }),
        );
      }
    } catch (error) {
      console.error('Error while sending acceptance:', error);
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{name: 'Tabs', state: {routes: [{name: 'Home'}]}}],
        }),
      );
    }
  };

  const rejectNotification = async userNotificationId => {
    try {
      // Retrieve the existing notifications
      const storedNotifications = await EncryptedStorage.getItem(
        'Requestnotifications',
      );
      const notifications = storedNotifications
        ? JSON.parse(storedNotifications)
        : [];

      // Filter out the notification with the matching userNotificationId
      const updatedNotifications = notifications.filter(
        notification =>
          notification.data.user_notification_id !== userNotificationId,
      );

      // Store the updated notifications back in EncryptedStorage
      await EncryptedStorage.setItem(
        'Requestnotifications',
        JSON.stringify(updatedNotifications),
      );

      // Update state with the new notifications array
      setNotificationsArray(updatedNotifications);
    } catch (error) {
      console.error('Failed to remove notification:', error);
    }
  };

  const setGreetingBasedOnTime = () => {
    const currentHour = new Date().getHours();
    let greetingMessage = 'Good Day';
    let icon = <Icon name="sunny-sharp" size={14} color="#ff5722" />;

    if (currentHour < 12) {
      greetingMessage = 'Good Morning';
      icon = <Icon name="sunny-sharp" size={16} color="#ff5722" />;
    } else if (currentHour < 17) {
      greetingMessage = 'Good Afternoon';
      icon = <Feather name="sunset" size={16} color="#ff5722" />;
    } else {
      greetingMessage = 'Good Evening';
      icon = <MaterialIcons name="nights-stay" size={16} color="#F24E1E" />;
    }

    setGreeting(greetingMessage);
    setGreetingIcon(icon);
  };

  const balanceScreen = () => {
    navigation.push('BalanceScreen');
  };

  // Request user permission for push notifications
  async function requestUserPermission() {
    const authStatus = await messaging().requestPermission();
    if (
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL
    ) {
      console.log('Authorization status:', authStatus);
    }
  }

  // Get FCM tokens
  const getTokens = async () => {
    try {
      const token = await messaging().getToken();

      await EncryptedStorage.setItem('fcm_token', token);

      const pcs_token = await EncryptedStorage.getItem('pcs_token');

      await axios.post(
        `https://backend.clicksolver.com/api/worker/store-fcm-token`,
        {fcmToken: token},
        {headers: {Authorization: `Bearer ${pcs_token}`}},
      );
    } catch (error) {
      console.error('Error storing FCM token in the backend:', error);
    }
  };

  useEffect(() => {
    fetchTrackDetails();
    fetchTrackingState();
    fetchNotifications();
    setGreetingBasedOnTime();
    requestUserPermission();
    getTokens();

    // Other initialization code...
  }, []);

  useEffect(() => {
    PushNotification.createChannel(
      {
        channelId: 'default-channel-id',
        channelName: 'Default Channel',
        channelDescription: 'A default channel',
        soundName: 'default',
        importance: 4,
        vibrate: true,
      },
      created => console.log(`createChannel returned ''`),
    );

    const storeNotificationLocally = async notification => {
      console.log('called atleast');
      // Check if notification has notification.data.notification_id
      if (notification.data.screen === 'Acceptance') {
        try {
          const existingNotifications = await EncryptedStorage.getItem(
            'Requestnotifications',
          );
          let notifications = existingNotifications
            ? JSON.parse(existingNotifications)
            : [];

          // Add the new notification to the array
          notifications.push(notification);

          // Get the receivedAt time from the notification
          const receivedAt = notification.receivedAt; // e.g., "06/10/2024, 11:26:16"

          // Manually parse receivedAt (from DD/MM/YYYY, HH:mm:ss to MM/DD/YYYY HH:mm:ss)
          const [datePart, timePart] = receivedAt.split(', ');
          const [day, month, year] = datePart.split('/');
          const parsedReceivedAt = `${year}-${month}-${day}T${timePart}`;
          const notificationDate = new Date(parsedReceivedAt);

          const currentDate = new Date();

          // Filter notifications received within the past 10 minutes
          const filteredNotifications = notifications.filter(noti => {
            const [notiDatePart, notiTimePart] = noti.receivedAt.split(', ');
            const [notiDay, notiMonth, notiYear] = notiDatePart.split('/');
            const parsedNotiReceivedAt = `${notiYear}-${notiMonth}-${notiDay}T${notiTimePart}`;
            const notiReceivedAt = new Date(parsedNotiReceivedAt);

            const timeDifferenceInMinutes =
              (currentDate - notiReceivedAt) / (1000 * 60); // milliseconds to minutes

            return timeDifferenceInMinutes <= 10;
          });

          // Update the notifications array with the filtered notifications
          notifications = filteredNotifications;

          // Update the notifications array and store locally
          setNotificationsArray(notifications);
          console.log('setNotificationsArray');
          // Store updated notifications in local storage
          await EncryptedStorage.setItem(
            'Requestnotifications',
            JSON.stringify(notifications),
          );

          // Also store in backend
        } catch (error) {
          console.error('Failed to store notification locally:', error);
        }
      } else {
        console.log('Notification does not match criteria. Not storing.');
      }
    };

    const unsubscribeOnMessage = messaging().onMessage(async remoteMessage => {
      console.log('Foreground Fcm', remoteMessage);
      const notificationId = remoteMessage.data.notification_id;
      const pcs_token = await EncryptedStorage.getItem('pcs_token');

      if (remoteMessage.data && remoteMessage.data.screen === 'Home') {
        await axios.post(
          `${process.env.BackendAPI}/api/worker/action`,
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
      } else if (
        remoteMessage.data &&
        remoteMessage.data.screen === 'TaskConfirmation'
      ) {
        navigation.push('TaskConfirmation', {encodedId: notificationId});
      }

      const notification = {
        title: remoteMessage.notification.title,
        body: remoteMessage.notification.body,
        data: remoteMessage.data,
        service: remoteMessage.data.service,
        location: remoteMessage.data.location,
        userNotificationId: remoteMessage.data.user_notification_id, // Include the user_notification_id
        receivedAt: new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(new Date()),
      };
      storeNotificationLocally(notification);

      PushNotification.localNotification({
        autoCancel: false,
        ongoing: true,
        channelId: 'default-channel-id',
        title: remoteMessage.notification.title,
        message: remoteMessage.notification.body,
        playSound: true,
        soundName: 'default',
        data: remoteMessage.data,
        userInfo: remoteMessage.data,
        actions: ['Dismiss'],
      });
    });

    PushNotification.configure({
      onNotification: function (Dismissnotification) {
        const userNotificationId = notification.data.user_notification_id;
        const route = notification.data.route;
        if (notification.action === 'Dismiss') {
          PushNotification.cancelLocalNotifications({id: notification.id});
        } else if (notification.userInteraction) {
          if (userNotificationId && route) {
            navigation.push(route, {encodedId: userNotificationId});
          }
        }
      },
      actions: ['Dismiss'],
    });

    messaging().setBackgroundMessageHandler(async remoteMessage => {
      console.log('setBackgroundMessageHandler Fcm', remoteMessage);
      const notificationId = remoteMessage.data.notification_id;

      if (remoteMessage.data && remoteMessage.data.screen === 'Home') {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{name: 'Tabs', state: {routes: [{name: 'Home'}]}}],
          }),
        );
      } else if (
        remoteMessage.data &&
        remoteMessage.data.screen === 'TaskConfirmation'
      ) {
        navigation.push('TaskConfirmation', {encodedId: notificationId});
      }
      const notification = {
        title: remoteMessage.notification.title,
        body: remoteMessage.notification.body,
        data: remoteMessage.data,
        service: remoteMessage.data.service,
        location: remoteMessage.data.location,
        userNotificationId: remoteMessage.data.user_notification_id, // Include the user_notification_id
        receivedAt: new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(new Date()),
      };
      storeNotificationLocally(notification);
    });

    const unsubscribeOnNotificationOpenedApp =
      messaging().onNotificationOpenedApp(async remoteMessage => {
        const notificationId = remoteMessage.data.notification_id;
        const pcs_token = await EncryptedStorage.getItem('pcs_token');

        if (remoteMessage.data && remoteMessage.data.screen === 'Home') {
          await axios.post(
            `${process.env.BackendAPI}/api/worker/action`,
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
        } else if (
          remoteMessage.data &&
          remoteMessage.data.screen === 'TaskConfirmation'
        ) {
          navigation.push('TaskConfirmation', {encodedId: notificationId});
        }
      });

    messaging()
      .getInitialNotification()
      .then(async remoteMessage => {
        if (remoteMessage) {
          const notificationId = remoteMessage.data.notification_id;
          const pcs_token = await EncryptedStorage.getItem('pcs_token');

          if (remoteMessage.data && remoteMessage.data.screen === 'Home') {
            await axios.post(
              `${process.env.BackendAPI}/api/worker/action`,
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
          } else if (
            remoteMessage.data &&
            remoteMessage.data.screen === 'TaskConfirmation'
          ) {
            navigation.push('TaskConfirmation', {encodedId: notificationId});
          }

          const notification = {
            title: remoteMessage.notification.title,
            body: remoteMessage.notification.body,
            data: remoteMessage.data,
            service: remoteMessage.data.service,
            location: remoteMessage.data.location,
            userNotificationId: remoteMessage.data.user_notification_id, // Include the user_notification_id
            receivedAt: new Intl.DateTimeFormat('en-IN', {
              timeZone: 'Asia/Kolkata',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            }).format(new Date()),
          };
          storeNotificationLocally(notification);
        }
      });

    return () => {
      unsubscribeOnMessage();
      unsubscribeOnNotificationOpenedApp();
    };
  }, []);

  return (
    <SafeAreaView style={styles.screenContainer}>
      <View style={styles.header}>
        <View style={styles.switchContainer}>
          <View>
            <MaterialCommunityIcons
              name="sort-variant"
              size={22}
              color="#656565"
            />
          </View>
          <View style={styles.innerSwitch}>
            <View style={styles.workStatusContainer}>
              <Text style={styles.workStatus}>Active</Text>
            </View>
            <View style={styles.container}>
              <TouchableOpacity
                onPress={toggleSwitch}
                style={[
                  styles.track,
                  isEnabled ? styles.trackEnabled : styles.trackDisabled,
                ]}>
                <View
                  style={[
                    styles.thumb,
                    isEnabled ? styles.thumbEnabled : styles.thumbDisabled,
                  ]}
                />
              </TouchableOpacity>
              <Text style={styles.status}>{isEnabled ? 'On' : 'Off'}</Text>
            </View>
          </View>
          <View>
            <TouchableOpacity
              style={styles.notificationContainer}
              onPress={() => navigation.push('RatingsScreen')}>
              <AntDesign name="staro" size={22} color="#656565" />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.greeting}>
          <Text style={styles.greetingText}>
            {greeting} <Text style={styles.greetingIcon}>{greetingIcon}</Text>
          </Text>
          <Text style={styles.userName}>Yaswanth</Text>
        </View>
        <View style={styles.moneyContainer}>
          <TouchableOpacity onPress={balanceScreen}>
            <View style={styles.balanceContainer}>
              <MaterialCommunityIcons
                name="bank-outline"
                size={20}
                color="#4a4a4a"
              />
              <Text style={styles.balanceText}>Balance</Text>
              <Entypo
                name="chevron-small-down"
                size={20}
                color="#2E8B57"
                style={styles.downArrow}
              />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={earningsScreen}>
            <View style={styles.balanceContainer}>
              <FontAwesome name="money" size={20} color="#4a4a4a" />
              <Text style={styles.balanceText}>Earnings</Text>
              <Entypo
                name="chevron-small-down"
                size={20}
                color="#2E8B57"
                style={styles.downArrow}
              />
            </View>
          </TouchableOpacity>
        </View>
      </View>
      {isEnabled ? (
        <>
          <Mapbox.MapView
            style={{minHeight: screenHeight, minWidth: screenWidth}}>
            <Mapbox.Camera zoomLevel={17} centerCoordinate={center} />
            <Mapbox.PointAnnotation id="current-location" coordinate={center}>
              <View style={styles.markerContainer}>
                <Octicons name="dot-fill" size={25} color="#0E52FB" />
              </View>
            </Mapbox.PointAnnotation>
          </Mapbox.MapView>
          {/* Include the LocationTracker component */}
          <LocationTracker
            isEnabled={isEnabled}
            onLocationUpdate={(latitude, longitude) => {
              setCenter([longitude, latitude]);
              setWorkerLocation([latitude, longitude]);
            }}
          />
        </>
      ) : (
        <Text style={styles.message}>Please click the switch on</Text>
      )}
      {isEnabled && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          pagingEnabled={false}
          contentContainerStyle={styles.scrollContainer}
          style={styles.messageScrollView}>
          {notificationsArray.map((notification, index) => {
            // Parse the title string if it's valid JSON
            let parsedTitle;
            let totalCost = 0;
            let cost = notification.data.cost;

            try {
              parsedTitle = JSON.parse(notification.data.service);

              totalCost = parsedTitle.reduce((accumulator, service) => {
                return accumulator + (service.cost || 0); // Default to 0 if cost is undefined
              }, 0);
            } catch (error) {
              console.error('Error parsing title:', error);
              parsedTitle = []; // Default to an empty array if parsing fails
            }

            return (
              <View key={index} style={styles.messageBox}>
                <View style={styles.serviceCostContainer}>
                  <View style={styles.serviceContainer}>
                    <Text style={styles.secondaryColor}>Service</Text>
                    <View
                      style={{
                        position:
                          'relative' /* container for arrows and scroll view */,
                      }}>
                      {showUpArrow && (
                        <View style={styles.arrowUpContainer}>
                          <Entypo
                            name="chevron-small-up"
                            size={20}
                            color="#9e9e9e"
                          />
                        </View>
                      )}

                      <ScrollView
                        style={styles.serviceNamesContainer}
                        contentContainerStyle={styles.serviceNamesContent}
                        onScroll={handleScroll}
                        scrollEventThrottle={16}>
                        {Array.isArray(parsedTitle) ? (
                          parsedTitle.map((service, serviceIndex) => (
                            <Text
                              key={serviceIndex}
                              style={styles.primaryColor}>
                              {service.serviceName}
                              {serviceIndex < parsedTitle.length - 1
                                ? ', '
                                : ''}
                            </Text>
                          ))
                        ) : (
                          <Text>No services available</Text>
                        )}
                      </ScrollView>

                      {showDownArrow && (
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
                  <View>
                    <Text style={styles.secondaryColor}>Cost</Text>
                    <Text style={styles.primaryColor}>₹{cost}</Text>
                  </View>
                </View>
                <View style={styles.addressContainer}>
                  <View>
                    <Text style={styles.secondaryColor}>Location</Text>
                    <Text style={styles.address}>
                      {notification.data.location}
                    </Text>
                  </View>
                </View>
                <View style={styles.buttonsContainer}>
                  <TouchableOpacity
                    onPress={() =>
                      rejectNotification(notification.data.user_notification_id)
                    }>
                    <Entypo name="cross" size={25} color="#9e9e9e" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() =>
                      acceptRequest(notification.data.user_notification_id)
                    }>
                    <Text style={styles.secondaryButtonText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
      {messageBoxDisplay && (
        <TouchableOpacity
          style={styles.messageBoxContainer}
          onPress={() => navigation.replace(screenName, params)}>
          <View style={styles.messageBox1}>
            <View style={styles.timeContainer}>
              {screenName === 'PaymentScreen' ? (
                <Foundation name="paypal" size={24} color="#ffffff" />
              ) : screenName === 'WorkerNavigation' ? (
                <MaterialCommunityIcons
                  name="truck"
                  size={24}
                  color="#ffffff"
                />
              ) : screenName === 'OtpVerification' ? (
                <Feather name="shield" size={24} color="#ffffff" />
              ) : screenName === 'TimingScreen' ? (
                <MaterialCommunityIcons
                  name="hammer"
                  size={24}
                  color="#ffffff"
                />
              ) : (
                <Feather name="alert-circle" size={24} color="#000" />
              )}
            </View>
            <View>
              <Text style={styles.textContainerText}>
                Switch board & Socket repairing
              </Text>
              {screenName === 'PaymentScreen' ? (
                <Text style={styles.textContainerTextCommander}>
                  Payment in progress
                </Text>
              ) : screenName === 'WorkerNavigation' ? (
                <Text style={styles.textContainerTextCommander}>
                  User is waiting for your help
                </Text>
              ) : screenName === 'OtpVerification' ? (
                <Text style={styles.textContainerTextCommander}>
                  User is waiting for your help
                </Text>
              ) : screenName === 'TimingScreen' ? (
                <Text style={styles.textContainerTextCommander}>
                  Work in progress
                </Text>
              ) : (
                <Text style={styles.textContainerText}>Nothing</Text>
              )}
            </View>
            <View style={styles.rightIcon}>
              <Feather name="chevrons-right" size={18} color="#9e9e9e" />
            </View>
          </View>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
};

const screenWidth = Dimensions.get('window').width;

const styles = StyleSheet.create({
  messageBoxContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    flexDirection: 'row',
    padding: 10,
    justifyContent: 'space-between',
    alignItems: 'center',
    elevation: 3,
    position: 'absolute',
    bottom: 8,
    left: 10,
    right: 10,
    marginHorizontal: '2%',
  },
  workerImage: {
    height: 40,
    width: 30,
  },
  messageBox1: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  timeContainer: {
    width: 50,
    height: 50,
    backgroundColor: '#ff5722',
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  timeContainerText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
    textAlign: 'center',
  },
  textContainerText: {
    fontSize: 13,
    paddingBottom: 5,
    fontWeight: 'bold',
    color: '#212121',
    marginLeft: 10,
  },
  status:{
    paddingLeft:10
  },
  serviceNamesContainer: {
    flexWrap: 'wrap',
    // Set a fixed height for the services container
    maxHeight: 60, // Adjust height according to your design
  },
  serviceNamesContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  arrowUpContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    // Optionally add background color / opacity for better visibility:
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  arrowDownContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  textContainerTextCommander: {
    fontSize: 12,
    color: '#9e9e9e',
    marginLeft: 10,
  },
  iconContainer: {
    width: 40,
    height: 40,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightIcon: {
    marginLeft: 8,
  },
  secondaryButton: {
    backgroundColor: '#FF5722',
    width: 120,
    height: 36,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  screenContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingBottom: 70,
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '600',
  },
  secondaryColor: {
    color: '#9e9e9e',
    fontSize: 16,
  },
  buttonsContainer: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  serviceCostContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  serviceContainer: {
    flex: 1,
  },
  addressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  markerContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageScrollView: {
    position: 'absolute',
    bottom: '-5%',
    left: 0,
    right: 0,
    height: 300,
  },
  scrollContainer: {
    paddingHorizontal: screenWidth * 0.05,
  },
  messageBox: {
    width: screenWidth * 0.85,
    height: 220, // Fixed card height
    backgroundColor: '#fff',
    marginRight: screenWidth * 0.05,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: {width: 0, height: 2},
    shadowRadius: 10,
    elevation: 5,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between', // Helps keep buttons at bottom
  },
  messageText: {
    fontSize: 16,
    color: '#333',
  },
  greeting: {
    flexDirection: 'column',
    alignItems: 'center',
    color: '#333',
    marginVertical: 10,
  },
  greetingText: {
    fontSize: 14,
    fontFamily: 'Roboto',
    lineHeight: 18.75,
    fontStyle: 'italic',
    color: '#808080',
    fontWeight: 'bold',
  },
  greetingIcon: {
    fontSize: 17,
  },
  userName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#4A4A4A',
    lineHeight: 21.09,
  },
  moneyContainer: {
    padding: 10,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  balanceContainer: {
    padding: 10,
    width: 162,
    height: 45,
    borderRadius: 25,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: {width: 0, height: 1},
    shadowRadius: 2,
    elevation: 1,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceText: {
    flex: 1,
    textAlign: 'center',
    color: '#212121',
    fontFamily: 'Poppins-Bold',
  },
  downArrow: {
    marginLeft: 10,
  },
  primaryColor: {
    color: '#212121',
    fontSize: 15,
  },
  address: {
    color: '#212121',
    fontSize: 12,
    width: 210,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  track: {
    width: 47,
    height: 27,
    borderRadius: 15,
    justifyContent: 'center',
    padding: 2,
  },
  trackEnabled: {
    backgroundColor: '#4CAF50',
  },
  trackDisabled: {
    backgroundColor: '#E1DAD2',
  },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: 13,
  },
  thumbEnabled: {
    backgroundColor: '#ffffff',
    alignSelf: 'flex-end',
  },
  thumbDisabled: {
    backgroundColor: '#f4f3f4',
    alignSelf: 'flex-start',
  },
  text: {
    color: '#000',
  },
  workStatus: {
    color: '#4CAF50',
    fontSize: 15,
  },
  workStatusContainer: {
    display: 'flex',
    alignSelf: 'center',
  },
  innerSwitch: {
    display: 'flex',
    flexDirection: 'row',
    gap: 10,
  },
  textCS: {
    paddingTop: 3,
    paddingRight: 5,
    fontSize: 13,
    color: '#7B6B6E',
  },
  notificationContainer: {
    display: 'flex',
    alignSelf: 'center',
  },
  earningsText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
  earnings: {
    padding: 10,
    backgroundColor: '#7B6B6E',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  markerContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12.5,
    justifyContent: 'center',
    alignItems: 'center',
    width: 25,
    height: 25,
    paddingBottom: 2,
  },
  switchContainer: {
    padding: 10,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  header: {
    backgroundColor: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
  },
  switch: {
    width: 47,
    height: 27,
  },
  userInitialCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  map: {
    flex: 1,
  },
  userInitialText: {
    fontSize: 18,
    color: '#333',
    fontWeight: 'bold',
  },
});

export default HomeScreen;
