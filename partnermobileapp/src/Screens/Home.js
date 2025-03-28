import React, {useState, useEffect, useCallback} from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  Animated 
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
import ThemeToggleIcon from '../Components/ThemeToggleIcon'; // Adjust the path accordingly
import { useTheme } from '../context/ThemeContext';

// Import the LocationTracker component
import LocationTracker from './LocationTracker';

// 1) We’ll use useWindowDimensions for responsive styling
import { useWindowDimensions } from 'react-native';

const HomeScreen = () => {
  // 2) Grab screen width & height
  const { width, height } = useWindowDimensions();
  // 3) Create dynamic styles
  const { isDarkMode } = useTheme();
  const styles = dynamicStyles(width, height, isDarkMode);

  const [center, setCenter] = useState([0, 0]);
  const [workerLocation, setWorkerLocation] = useState([]);
  const [activeModalVisible, setActiveModalVisible] = useState(false);
  const navigation = useNavigation();
  const [notificationsArray, setNotificationsArray] = useState([]);
  const [screenName, setScreenName] = useState(null);
  const [params, setParams] = useState(null);
  const [messageBoxDisplay, setMessageBoxDisplay] = useState(false);
  const [isEnabled, setIsEnabled] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [greeting, setGreeting] = useState('');
  const [greetingIcon, setGreetingIcon] = useState(null);
  const [showUpArrow, setShowUpArrow] = useState(false);
  const [showDownArrow, setShowDownArrow] = useState(false);

  // NEW: For the inspection confirmation modal
  const [inspectionModalVisible, setInspectionModalVisible] = useState(false);
  const [pendingNotificationId, setPendingNotificationId] = useState(null);
  const AnimatedMarker = Animated.createAnimatedComponent(View);

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
    const filteredNotifications = notifications.filter((noti) => {
      const [notiDatePart, notiTimePart] = noti.receivedAt.split(', ');
      const [notiDay, notiMonth, notiYear] = notiDatePart.split('/');
      const parsedNotiReceivedAt = `${notiYear}-${notiMonth}-${notiDay}T${notiTimePart}`;
      const notiReceivedAt = new Date(parsedNotiReceivedAt);

      const timeDifferenceInMinutes =
        (currentDate - notiReceivedAt) / (1000 * 60); // ms -> min

      return timeDifferenceInMinutes <= 10;
    });

    notifications = filteredNotifications;
    setNotificationsArray(notifications);

    await EncryptedStorage.setItem(
      'Requestnotifications',
      JSON.stringify(notifications),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchNotifications();
    }, [fetchNotifications]),
  );

  // Helper function to check if a worker is already on another service
const checkWorkerStatus = async () => {
  try {
    const pcs_token = await EncryptedStorage.getItem('pcs_token');
    const response = await axios.get(
      `https://backend.clicksolver.com/api/worker/track/details`,
      {
        headers: { Authorization: `Bearer ${pcs_token}` },
      }
    );
    // Extract the route; if it's not null then the worker is already active on a service.
    const { route } = response.data;
    return route || null;
  } catch (error) {
    console.error('Error checking worker status:', error);
    // In case of error, assume no active service to avoid blocking the worker unnecessarily.
    return null;
  }
};

  const handleScroll = (event) => {
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
            headers: { Authorization: `Bearer ${pcs_token}` },
          }
        );

        const { route, parameter } = response.data;
        const params = parameter ? JSON.parse(parameter) : null;

        const screenName = route || null;
        console.log("scr", response.data);

        // If no route or if route is "Paymentscreen"/"worktimescreen" => remove "workerInAction"
        if (!route || screenName === "Paymentscreen" || screenName === "worktimescreen") {
          console.log(`Removing workerInAction due to screen: ${screenName || "No Route"}`);
          await EncryptedStorage.removeItem("workerInAction");
        }

        setScreenName(screenName || "");
        setParams(params || {});
        setMessageBoxDisplay(!!route);
      } else {
        console.log("No pcs_token found, removing workerInAction key and redirecting to Login");
        await EncryptedStorage.removeItem("workerInAction");
        navigation.replace('Login');
      }
    } catch (error) {
      console.error('Error fetching track details:', error);
      await EncryptedStorage.removeItem("workerInAction"); // Ensure cleanup on error
    }
  };

  const toggleSwitch = async () => {
    setIsEnabled((prevState) => {
      const newEnabledState = !prevState;
      EncryptedStorage.setItem(
        'trackingEnabled',
        JSON.stringify(newEnabledState),
      ).catch((error) => {
        console.error('Error saving enabled state:', error);
      });
      return newEnabledState;
    });
  };

  const fetchTrackingState = async () => {
    try {
      const storedState = await EncryptedStorage.getItem('trackingEnabled');
      // Update isEnabled based on stored value (default to false if not found)
      setIsEnabled(storedState !== null ? JSON.parse(storedState) : false);
    } catch (error) {
      console.error('Error fetching tracking state:', error);
      setIsEnabled(false);
    }
  };
  

  const earningsScreen = () => {
    navigation.push('Earnings');
  };

  const acceptRequest = async (userNotificationId) => {
    // Check if the worker is already engaged in another service.
    const activeScreen = await checkWorkerStatus();
    if (activeScreen !== null) {
      // Instead of using alert, open our custom modal
      setActiveModalVisible(true);
      return;
    }
  
    const decodedId = Buffer.from(userNotificationId, 'base64').toString('ascii');
    const notif = notificationsArray.find(
      (n) => n.data.user_notification_id === userNotificationId
    );
  
    let requiresInspectionConfirmation = false;
  
    if (notif && notif.data.service) {
      try {
        const serviceData = JSON.parse(notif.data.service);
        requiresInspectionConfirmation = serviceData.some((s) =>
          s.serviceName.toLowerCase().includes('inspection')
        );
      } catch (error) {
        console.error('Error parsing service data:', error);
      }
    }
  
    if (requiresInspectionConfirmation) {
      setPendingNotificationId(userNotificationId);
      setInspectionModalVisible(true);
      return;
    }
  
    // Otherwise, finalize acceptance
    await finalizeAcceptRequest(userNotificationId);
  };

  const finalizeAcceptRequest = async (userNotificationId) => {
    const decodedId = Buffer.from(userNotificationId, 'base64').toString('ascii');
    try {
      const jwtToken = await EncryptedStorage.getItem('pcs_token');
      const response = await axios.post(
        `https://backend.clicksolver.com/api/accept/request`,
        { user_notification_id: decodedId },
        { headers: { Authorization: `Bearer ${jwtToken}` } }
      );
  
      if (response.status === 200) {
        // Remove the accepted notification
        setNotificationsArray((prev) => {
          const updated = prev.filter(
            (n) => n.data.user_notification_id !== userNotificationId
          );
          EncryptedStorage.setItem('Requestnotifications', JSON.stringify(updated));
          return updated;
        });
  
        const { notificationId } = response.data;
        const encodedNotificationId = Buffer.from(notificationId.toString()).toString('base64');
        const pcs_token = await EncryptedStorage.getItem('pcs_token');
  
        await axios.post(
          `https://backend.clicksolver.com/api/worker/action`,
          { encodedId: encodedNotificationId, screen: 'UserNavigation' },
          { headers: { Authorization: `Bearer ${pcs_token}` } }
        );
  
        await EncryptedStorage.setItem('workerInAction', 'true');
  
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'UserNavigation', params: { encodedId: encodedNotificationId } }],
          })
        );
      } else {
        const pcs_token = await EncryptedStorage.getItem('pcs_token');
        await axios.post(
          `https://backend.clicksolver.com/api/worker/action`,
          { encodedId: '', screen: '' },
          { headers: { Authorization: `Bearer ${pcs_token}` } }
        );
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Tabs', state: { routes: [{ name: 'Home' }] } }],
          })
        );
      }
    } catch (error) {
      console.error('Error while sending acceptance:', error);
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Tabs', state: { routes: [{ name: 'Home' }] } }],
        })
      );
    }
  };

  const rejectNotification = async (userNotificationId) => {
    try {
      const storedNotifications = await EncryptedStorage.getItem(
        'Requestnotifications'
      );
      const notifications = storedNotifications ? JSON.parse(storedNotifications) : [];
      const updated = notifications.filter(
        (n) => n.data.user_notification_id !== userNotificationId
      );
      await EncryptedStorage.setItem('Requestnotifications', JSON.stringify(updated));
      setNotificationsArray(updated);
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
      const storedToken = await EncryptedStorage.getItem('fcm_token');
      if (storedToken) {
        console.log('FCM token already exists, skipping backend update.');
        return;
      }
      const newToken = await messaging().getToken();
      console.log("token",newToken)
      if (!newToken) {
        console.error('Failed to retrieve FCM token.');
        return;
      }
      

      const pcs_token = await EncryptedStorage.getItem('pcs_token');
      if (!pcs_token) {
        console.error('No PCS token found, skipping FCM update.');
        return;
      }

      const response = await axios.post(
        `https://backend.clicksolver.com/api/worker/store-fcm-token`,
        { fcmToken: newToken },
        { headers: { Authorization: `Bearer ${pcs_token}` } },
      );
      if (response.status === 200){
        await EncryptedStorage.setItem('fcm_token', newToken);
      }
      
      console.log('New FCM token stored and sent to backend.');
    } catch (error) {
      console.error('Error handling FCM token:', error);
    }
  };

  useEffect(() => {
    fetchTrackingState();
    fetchNotifications();
    setGreetingBasedOnTime();
    requestUserPermission();
    getTokens();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTrackDetails();
    }, []),
  );

  useEffect(() => {
    // Create channel
    PushNotification.createChannel(
      {
        channelId: 'default-channel-id',
        channelName: 'Default Channel',
        channelDescription: 'A default channel',
        soundName: 'default',
        importance: 4,
        vibrate: true,
      },
      (created) => console.log(`createChannel returned ''`),
    );

    const storeNotificationLocally = async (notification) => {
      if (notification.data.screen === 'Acceptance') {
        try {
          const existing = await EncryptedStorage.getItem('Requestnotifications');
          let notifications = existing ? JSON.parse(existing) : [];
          notifications.push(notification);

          const currentDate = new Date();
          const filtered = notifications.filter((noti) => {
            const [datePart, timePart] = noti.receivedAt.split(', ');
            const [d, m, y] = datePart.split('/');
            const parsed = `${y}-${m}-${d}T${timePart}`;
            const notiReceivedAt = new Date(parsed);
            const diff = (currentDate - notiReceivedAt) / (1000 * 60);
            return diff <= 10;
          });

          notifications = filtered;
          setNotificationsArray(notifications);
          await EncryptedStorage.setItem(
            'Requestnotifications',
            JSON.stringify(notifications),
          );
        } catch (error) {
          console.error('Failed to store notification locally:', error);
        }
      } else {
        console.log('Notification does not match criteria. Not storing.');
      }
    };

    const unsubscribeOnMessage = messaging().onMessage(async (remoteMessage) => {
      console.log('Foreground FCM', remoteMessage);
      const notificationId = remoteMessage.data.notification_id;
      const pcs_token = await EncryptedStorage.getItem('pcs_token');

      if (remoteMessage.data && remoteMessage.data.screen === 'Home') {
        await axios.post(
          `${process.env.BackendAPI}/api/worker/action`,
          { encodedId: '', screen: '' },
          { headers: { Authorization: `Bearer ${pcs_token}` } },
        );
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Tabs', state: { routes: [{ name: 'Home' }] } }],
          }),
        );
      } else if (remoteMessage.data && remoteMessage.data.screen === 'TaskConfirmation') {
        navigation.push('TaskConfirmation', { encodedId: notificationId });
      }

      const notification = {
        title: remoteMessage.notification.title,
        body: remoteMessage.notification.body,
        data: remoteMessage.data,
        service: remoteMessage.data.service,
        location: remoteMessage.data.location,
        user_notification_id: remoteMessage.data.user_notification_id,
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
        if (Dismissnotification.action === 'Dismiss') {
          PushNotification.cancelLocalNotifications({ id: Dismissnotification.id });
        } else if (Dismissnotification.userInteraction) {
          // handle user interaction
        }
      },
      actions: ['Dismiss'],
    });

    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      console.log('setBackgroundMessageHandler FCM', remoteMessage);
      const notificationId = remoteMessage.data.notification_id;
      if (remoteMessage.data && remoteMessage.data.screen === 'Home') {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Tabs', state: { routes: [{ name: 'Home' }] } }],
          }),
        );
      } else if (remoteMessage.data && remoteMessage.data.screen === 'TaskConfirmation') {
        navigation.push('TaskConfirmation', { encodedId: notificationId });
      }

      const notification = {
        title: remoteMessage.notification.title,
        body: remoteMessage.notification.body,
        data: remoteMessage.data,
        service: remoteMessage.data.service,
        location: remoteMessage.data.location,
        user_notification_id: remoteMessage.data.user_notification_id,
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

    const unsubscribeOnNotificationOpenedApp = messaging().onNotificationOpenedApp(
      async (remoteMessage) => {
        const notificationId = remoteMessage.data.notification_id;
        const pcs_token = await EncryptedStorage.getItem('pcs_token');

        if (remoteMessage.data && remoteMessage.data.screen === 'Home') {
          await axios.post(
            `${process.env.BackendAPI}/api/worker/action`,
            { encodedId: '', screen: '' },
            { headers: { Authorization: `Bearer ${pcs_token}` } },
          );
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'Tabs', state: { routes: [{ name: 'Home' }] } }],
            }),
          );
        } else if (
          remoteMessage.data &&
          remoteMessage.data.screen === 'TaskConfirmation'
        ) {
          navigation.push('TaskConfirmation', { encodedId: notificationId });
        }
        const notification = {
          title: remoteMessage.notification.title,
          body: remoteMessage.notification.body,
          data: remoteMessage.data,
          service: remoteMessage.data.service,
          location: remoteMessage.data.location,
          user_notification_id: remoteMessage.data.user_notification_id,
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
      },
    );

    messaging()
      .getInitialNotification()
      .then(async (remoteMessage) => {
        if (remoteMessage) {
          const notificationId = remoteMessage.data.notification_id;
          const pcs_token = await EncryptedStorage.getItem('pcs_token');

          if (remoteMessage.data && remoteMessage.data.screen === 'Home') {
            await axios.post(
              `${process.env.BackendAPI}/api/worker/action`,
              { encodedId: '', screen: '' },
              { headers: { Authorization: `Bearer ${pcs_token}` } },
            );
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Tabs', state: { routes: [{ name: 'Home' }] } }],
              }),
            );
          } else if (
            remoteMessage.data &&
            remoteMessage.data.screen === 'TaskConfirmation'
          ) {
            navigation.push('TaskConfirmation', { encodedId: notificationId });
          }

          const notification = {
            title: remoteMessage.notification.title,
            body: remoteMessage.notification.body,
            data: remoteMessage.data,
            service: remoteMessage.data.service,
            location: remoteMessage.data.location,
            user_notification_id: remoteMessage.data.user_notification_id,
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

          {/* <View>
            <MaterialCommunityIcons
              name="sort-variant"
              size={22}
              color="#656565"
            />
            
          </View> */}
          <View>
    <ThemeToggleIcon />
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
                ]}
              >
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
              onPress={() => navigation.push('RatingsScreen')}
            >
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



      {/* {isEnabled ? (
        <>
          <Mapbox.MapView style={{ minHeight: height, minWidth: width }}>
            <Mapbox.Camera
              zoomLevel={17}
              centerCoordinate={center}
              animationDuration={1000}  // smooth camera transition
            />
            <Mapbox.PointAnnotation id="current-location" coordinate={center}>
              <View style={styles.markerContainer}>
                <Octicons name="dot-fill" size={25} color="#0E52FB" />
              </View>
            </Mapbox.PointAnnotation>
          </Mapbox.MapView>

          
          {console.log('[HOME] Current tracking state:', isEnabled)}
        
          <LocationTracker
            isEnabled={isEnabled}
            onLocationUpdate={(latitude, longitude) => {
              // Update center state so that the camera smoothly pans to the new location.
              setCenter([longitude, latitude]);
              setWorkerLocation([latitude, longitude]);
            }}
          />
        </>
      ) : (
        <Text style={styles.message}>Please click the switch on</Text>
      )} */}

      {isEnabled !== null && (
        <LocationTracker
          isEnabled={isEnabled}
          onLocationUpdate={(latitude, longitude) => {
            setCenter([longitude, latitude]);
            setWorkerLocation([latitude, longitude]);
          }}
        />
      )}

    {isEnabled ? (
      <>
        <Mapbox.MapView style={{ minHeight: height, minWidth: width }}>
          <Mapbox.Camera zoomLevel={17} centerCoordinate={center} animationDuration={1000} />
          <Mapbox.PointAnnotation id="current-location" coordinate={center}>
            <View style={styles.markerContainer}>
              <Octicons name="dot-fill" size={25} color="#0E52FB" />
            </View>
          </Mapbox.PointAnnotation>
        </Mapbox.MapView>
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
          style={styles.messageScrollView}
        >
          {notificationsArray.map((notification, index) => {
            let parsedTitle = [];
            let cost = notification.data.cost;

            try {
              parsedTitle = JSON.parse(notification.data.service);
            } catch (error) {
              console.error('Error parsing title:', error);
            }

            return (
              <View key={index} style={styles.messageBox}>
                <View style={styles.serviceCostContainer}>
                  <View style={styles.serviceContainer}>
                    <Text style={styles.secondaryColor}>Service</Text>
                    <View style={{ position: 'relative' }}>
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
                        scrollEventThrottle={16}
                      >
                        {Array.isArray(parsedTitle) ? (
                          parsedTitle.map((service, serviceIndex) => (
                            <Text key={serviceIndex} style={styles.primaryColor}>
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
                    }
                  >
                    <Entypo name="cross" size={25} color="#9e9e9e" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() =>
                      acceptRequest(notification.data.user_notification_id)
                    }
                  >
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
          onPress={() => navigation.replace(screenName, params)}
        >
          <View style={styles.messageBox1}>
            <View style={styles.timeContainer}>
              {screenName === 'Paymentscreen' ? (
                <Foundation name="paypal" size={24} color="#ffffff" />
              ) : screenName === 'UserNavigation' ? (
                <MaterialCommunityIcons
                  name="truck"
                  size={24}
                  color="#ffffff"
                />
              ) : screenName === 'OtpVerification' ? (
                <Feather name="shield" size={24} color="#ffffff" />
              ) : screenName === 'worktimescreen' ? (
                <MaterialCommunityIcons name="hammer" size={24} color="#ffffff" />
              ) : (
                <Feather name="alert-circle" size={24} color="#000" />
              )}
            </View>
            <View>
              {screenName === 'Paymentscreen' ? (
                <Text style={styles.textContainerText}>
                  Payment in progress
                </Text>
              ) : screenName === 'UserNavigation' ? (
                <Text style={styles.textContainerText}>
                  User is waiting for your help
                </Text>
              ) : screenName === 'OtpVerification' ? (
                <Text style={styles.textContainerText}>
                  User is waiting for your help
                </Text>
              ) : screenName === 'worktimescreen' ? (
                <Text style={styles.textContainerText}>Work in progress</Text>
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

       {/* Custom Modal for active service */}
       <Modal
        visible={activeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Active Service</Text>
            <Text style={styles.modalMessage}>
              You are already engaged with another service.
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setActiveModalVisible(false)}
            >
              <Text style={styles.modalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/** INSPECTION CONFIRMATION MODAL */}
      <Modal
        animationType="slide"
        transparent
        visible={inspectionModalVisible}
        onRequestClose={() => setInspectionModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Inspection Confirmation</Text>
            <Text style={styles.modalMessage}>
              The service request includes an inspection.
              {'\n'}Inspection fee is ₹49. If you are comfortable with just
              inspecting, click "Sure" to accept. Otherwise, click "Cancel".
            </Text>
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalSureButton]}
                onPress={() => {
                  finalizeAcceptRequest(pendingNotificationId);
                  setInspectionModalVisible(false);
                }}
              >
                <Text style={styles.modalButtonText}>Sure</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancelButton]}
                onPress={() => setInspectionModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

/**
 * 4) A helper function that returns a StyleSheet based on screen width & height.
 *    If width >= 600, we treat it as a tablet and scale up certain styles.
 */
function dynamicStyles(width, height, isDarkMode) {
  const isTablet = width >= 600;
  return StyleSheet.create({
    screenContainer: {
      flex: 1,
      backgroundColor: isDarkMode ? '#000000' : '#ffffff',
      paddingBottom: 70,
    },
    header: {
      backgroundColor: isDarkMode ? '#121212' : '#ffffff',
      flexDirection: 'column',
    },
    switchContainer: {
      padding: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    innerSwitch: {
      flexDirection: 'row',
      gap: 10,
    },
    workStatusContainer: {
      alignSelf: 'center',
    },
    workStatus: {
      color: '#4CAF50',
      fontSize: isTablet ? 16 : 15,
    },
    container: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    track: {
      width: isTablet ? 52 : 47,
      height: isTablet ? 32 : 27,
      borderRadius: isTablet ? 18 : 15,
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
      width: isTablet ? 28 : 24,
      height: isTablet ? 28 : 24,
      borderRadius: isTablet ? 14 : 13,
    },
    thumbEnabled: {
      backgroundColor: '#ffffff',
      alignSelf: 'flex-end',
    },
    thumbDisabled: {
      backgroundColor: '#f4f3f4',
      alignSelf: 'flex-start',
    },
    status: {
      paddingLeft: 10,
      fontSize: isTablet ? 16 : 14,
      color: isDarkMode ? '#ffffff' : '#212121',
    },
    notificationContainer: {
      alignSelf: 'center',
    },
    greeting: {
      flexDirection: 'column',
      alignItems: 'center',
      marginVertical: isTablet ? 12 : 10,
    },
    greetingText: {
      fontSize: isTablet ? 16 : 14,
      fontStyle: 'italic',
      color: isDarkMode ? '#bbbbbb' : '#808080',
      fontWeight: 'bold',
    },
    greetingIcon: {
      fontSize: isTablet ? 18 : 16,
    },
    userName: {
      fontSize: isTablet ? 18 : 16,
      fontWeight: '500',
      color: isDarkMode ? '#ffffff' : '#4A4A4A',
      marginTop: 4,
    },
    moneyContainer: {
      padding: 10,
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginBottom: isTablet ? 12 : 10,
    },
    balanceContainer: {
      padding: isTablet ? 12 : 10,
      width: isTablet ? 180 : 162,
      height: isTablet ? 50 : 45,
      borderRadius: isTablet ? 28 : 25,
      backgroundColor: isDarkMode ? '#333333' : '#ffffff',
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 2,
      elevation: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginHorizontal: isTablet ? 5 : 2,
    },
    balanceText: {
      flex: 1,
      textAlign: 'center',
      color: isDarkMode ? '#ffffff' : '#212121',
      fontWeight: 'bold',
      fontSize: isTablet ? 16 : 14,
    },
    downArrow: {
      marginLeft: 10,
    },
    markerContainer: {
      backgroundColor: isDarkMode ? '#222222' : '#ffffff',
      borderRadius: 12.5,
      justifyContent: 'center',
      alignItems: 'center',
      width: isTablet ? 30 : 25,
      height: isTablet ? 30 : 25,
      paddingBottom: 2,
    },
    message: {
      fontSize: isTablet ? 16 : 14,
      textAlign: 'center',
      marginTop: 20,
      color: isDarkMode ? '#888888' : '#777777',
    },
    messageScrollView: {
      position: 'absolute',
      bottom: '-5%',
      left: 0,
      right: 0,
      height: 300,
    },
    scrollContainer: {
      paddingHorizontal: width * 0.05,
    },
    messageBox: {
      width: width * 0.85,
      height: isTablet ? 240 : 220,
      backgroundColor: isDarkMode ? '#222222' : '#fff',
      marginRight: width * 0.05,
      borderRadius: 10,
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 10,
      elevation: 5,
      padding: isTablet ? 24 : 20,
      flexDirection: 'column',
      justifyContent: 'space-between',
    },
    serviceCostContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    serviceContainer: {
      flex: 1,
      marginRight: 10,
    },
    secondaryColor: {
      color: isDarkMode ? '#cccccc' : '#9e9e9e',
      fontSize: isTablet ? 17 : 15,
    },
    serviceNamesContainer: {
      maxHeight: 60,
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
    primaryColor: {
      color: isDarkMode ? '#ffffff' : '#212121',
      fontSize: isTablet ? 16 : 14,
    },
    addressContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginTop: 10,
    },
    address: {
      color: isDarkMode ? '#ffffff' : '#212121',
      fontSize: isTablet ? 13 : 12,
      width: isTablet ? 240 : 210,
    },
    buttonsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 10,
    },
    secondaryButton: {
      backgroundColor: '#FF5722',
      width: isTablet ? 130 : 120,
      height: isTablet ? 40 : 36,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
    },
    secondaryButtonText: {
      color: '#ffffff',
      fontSize: isTablet ? 15 : 14,
      fontWeight: '600',
    },
    messageBoxContainer: {
      backgroundColor: isDarkMode ? '#333333' : '#ffffff',
      borderRadius: 10,
      flexDirection: 'row',
      padding: isTablet ? 12 : 10,
      justifyContent: 'space-between',
      alignItems: 'center',
      elevation: 3,
      position: 'absolute',
      bottom: isTablet ? 12 : 8,
      left: 10,
      right: 10,
    },
    messageBox1: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    },
    timeContainer: {
      width: isTablet ? 55 : 50,
      height: isTablet ? 55 : 50,
      backgroundColor: '#ff5722',
      borderRadius: isTablet ? 27.5 : 25,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: isTablet ? 20 : 16,
    },
    textContainerText: {
      fontSize: isTablet ? 16 : 15,
      paddingBottom: 5,
      fontWeight: 'bold',
      color: isDarkMode ? '#ffffff' : '#212121',
      marginLeft: 10,
    },
    rightIcon: {
      marginLeft: 8,
    },
    // Modal styles
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: isDarkMode ? '#333333' : '#fff',
      padding: isTablet ? 24 : 20,
      borderRadius: 10,
      width: isTablet ? '60%' : '80%',
      alignItems: 'center',
    },
    modalTitle: {
      fontSize: isTablet ? 20 : 18,
      fontWeight: 'bold',
      marginBottom: 10,
      textAlign: 'center',
      color: isDarkMode ? '#ffffff' : '#000000',
    },
    modalMessage: {
      fontSize: isTablet ? 16 : 14,
      textAlign: 'center',
      marginBottom: 20,
      color: isDarkMode ? '#dddddd' : '#333333',
    },
    modalButtonsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
    },
    modalButton: {
      flex: 1,
      paddingVertical: isTablet ? 12 : 10,
      borderRadius: 8,
      alignItems: 'center',
      marginHorizontal: 5,
    },
    modalSureButton: {
      backgroundColor: '#FF5722',
    },
    modalCancelButton: {
      backgroundColor: '#BDBDBD',
    },
    modalButtonText: {
      color: '#fff',
      fontSize: isTablet ? 16 : 14,
      fontWeight: '600',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)', // semi-transparent background
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContainer: {
      width: '80%',
      backgroundColor: isDarkMode ? '#000000' : '#000000',
      borderRadius: 10,
      paddingVertical: 20,
      paddingHorizontal: 25,
      alignItems: 'center',
      elevation: 5,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '600',
      marginBottom: 10,
    },
    modalMessage: {
      fontSize: 16,
      textAlign: 'center',
      marginBottom: 20,
    },
    modalButton: {
      backgroundColor: '#ff5722',
      borderRadius: 5,
      paddingVertical: 10,
      paddingHorizontal: 20,
    },
    modalButtonText: {
      color: '#fff',
      fontSize: 16,
    },
  });
}

export default HomeScreen;
 