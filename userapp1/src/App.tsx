import React, {useEffect, useRef, useState} from 'react';
import {NavigationContainer, CommonActions} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import axios from 'axios';
import messaging from '@react-native-firebase/messaging';
import PushNotification from 'react-native-push-notification';
import EncryptedStorage from 'react-native-encrypted-storage';
import {ActivityIndicator, Platform, View} from 'react-native';
import {
  requestMultiple,
  checkMultiple,
  PERMISSIONS,
  RESULTS,
} from 'react-native-permissions';
import Feather from 'react-native-vector-icons/Feather';
import Entypo from 'react-native-vector-icons/Entypo';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Config from 'react-native-config';

// Import your components and screens
import UserLocation from './Components/userLocation';
import WaitingUser from './Components/UserWaiting';
import Navigation from './Components/Navigation';
import TimingScreen from './Components/TimingScreen';
import Payment from './Components/Paymentscreen';
import Rating from './Components/RatingScreen';
import ServiceApp from './screens/SecondPage';
import PaintingServices from './screens/Indiv';
import SearchItem from './Components/SearchItem';
import SplashScreen from 'react-native-splash-screen';
import HelpScreen from './Components/HelpScreen';
import SingleService from './screens/SingleService';
import RecentServices from './Components/RecentServices';
import ProfileScreen from './Components/ProfileScreen';
import EditProfile from './Components/EditProfile';
import LocationSearch from './Components/LocationSearch';
import LoginScreen from './Components/LoginScreen';
import SignUpScreen from './Components/SignUpScreen';
import ServiceTrackingItemScreen from './Components/ServiceTrackingItemScreen';
import ServiceTrackingListScreen from './Components/ServiceTrackingListScreen';
import ServiceBookingItem from './Components/ServiceBookingItem';
import UserNotifications from './screens/UserNotifications';
import ServiceInProgress from './Components/ServiceInProgress';
import AccountDelete from './Components/AccountDelete';
import ReferralScreen from './Components/ReferralScreen';
import OnboardingScreen from './Components/OnboardingScreen';
import OrderScreen from './Components/OrderScreen';
import Myrefferals from './Components/Myrefferals';
import Help from './Components/Help';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        tabBarIcon: ({focused, color, size}) => {
          size = focused ? 28 : 24;
          let iconName;

          if (route.name === 'Home') {
            iconName = 'home';
            return <Feather name={iconName} size={size} color={color} />;
          } else if (route.name === 'Bookings') {
            iconName = 'clipboard';
            return <Feather name={iconName} size={size} color={color} />;
          } else if (route.name === 'Rewards') {
            iconName = 'wallet';
            return <Entypo name={iconName} size={size} color={color} />;
          } else if (route.name === 'Tracking') {
            iconName = 'shopping-bag';
            return <Feather name={iconName} size={size} color={color} />;
          } else if (route.name === 'Account') {
            iconName = 'account-outline';
            return (
              <MaterialCommunityIcons
                name={iconName}
                size={size}
                color={color}
              />
            );
          }
        },
        tabBarActiveTintColor: '#ff4500',
        tabBarInactiveTintColor: 'gray',
        tabBarLabelStyle: {fontSize: 12},
        tabBarStyle: {height: 60, paddingBottom: 5, paddingTop: 5},
      })}>
      <Tab.Screen
        name="Home"
        component={ServiceApp}
        options={{headerShown: false}}
      />
      <Tab.Screen
        name="Bookings"
        component={RecentServices}
        options={{headerShown: false}}
      />
      <Tab.Screen
        name="Tracking"
        component={ServiceTrackingListScreen}
        options={{headerShown: false}}
      />
      <Tab.Screen
        name="Account"
        component={ProfileScreen}
        options={{headerShown: false}}
      />
    </Tab.Navigator>
  );
}

function App() {
  const navigationRef = useRef(null);
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  async function requestAllPermissions() {
    const permissions = {
      ios: [
        PERMISSIONS.IOS.LOCATION_WHEN_IN_USE,
        PERMISSIONS.IOS.LOCATION_ALWAYS,
        PERMISSIONS.IOS.NOTIFICATIONS,
        PERMISSIONS.IOS.CONTACTS,
      ],
      android: [
        PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
        PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION,
        PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION,
        PERMISSIONS.ANDROID.POST_NOTIFICATIONS,
        PERMISSIONS.ANDROID.READ_CONTACTS,
      ],
    };

    const osPermissions =
      Platform.OS === 'ios' ? permissions.ios : permissions.android;

    // Check current permission statuses
    const currentStatuses = await checkMultiple(osPermissions);
    console.log('Current Permission Statuses:', currentStatuses);

    // Request permissions if not already granted
    const permissionsToRequest = osPermissions.filter(
      perm => currentStatuses[perm] !== RESULTS.GRANTED,
    );

    if (permissionsToRequest.length > 0) {
      const newStatuses = await requestMultiple(permissionsToRequest);
      console.log('Updated Permission Statuses:', newStatuses);
    } else {
      console.log('All necessary permissions are already granted.');
    }
  }

  // Request user permissions for notifications
  // async function requestUserPermission() {
  //   const authStatus = await messaging().requestPermission();
  //   const enabled =
  //     authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
  //     authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  //   if (enabled) {
  //     console.log('Authorization status:', authStatus);
  //   } else {
  //     console.log('Notification permission not granted');
  //   }
  // }

  // // Request notification permission for Android
  // async function requestNotificationPermission() {
  //   const granted = await PermissionsAndroid.request(
  //     PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  //     {
  //       title: 'Notification Permission',
  //       message:
  //         'This app needs access to your notifications so you can receive important updates.',
  //       buttonNeutral: 'Ask Me Later',
  //       buttonNegative: 'Cancel',
  //       buttonPositive: 'OK',
  //     },
  //   );
  //   if (granted === PermissionsAndroid.RESULTS.GRANTED) {
  //     console.log('You can use the notifications');
  //   } else {
  //     console.log('Notification permission denied');
  //   }
  // }

  // Get FCM tokens and store them
  async function getTokens() {
    try {
      const fcm = await EncryptedStorage.getItem('fcm_token');
      const cs_token = await EncryptedStorage.getItem('cs_token');
      console.log(fcm);
      if (!fcm && cs_token) {
        const token = await messaging().getToken();
        await EncryptedStorage.setItem('fcm_token', token);
        const cs_token = await EncryptedStorage.getItem('cs_token');
        if (cs_token) {
          await axios.post(
            `https://backend.clicksolver.com/api/user/store-fcm-token`,
            {fcmToken: token},
            {headers: {Authorization: `Bearer ${cs_token}`}},
          );
        }
      }
    } catch (error) {
      console.error('Error storing FCM token in the backend:', error);
    }
  }

  // Store notification in backend
  async function storeNotificationInBackend(notification) {
    try {
      const pcs_token = await EncryptedStorage.getItem('cs_token');
      const fcmToken = await EncryptedStorage.getItem('fcm_token');
      await axios.post(
        `https://backend.clicksolver.com/api/user/store-notification`,
        {notification, fcmToken},
        {headers: {Authorization: `Bearer ${pcs_token}`}},
      );
      console.log('Notification stored in backend:', notification);
    } catch (error) {
      console.error('Failed to store notification in backend:', error);
    }
  }

  // Store notification locally
  async function storeNotificationLocally(notification) {
    try {
      const existingNotifications = await EncryptedStorage.getItem(
        'notifications',
      );
      let notifications = existingNotifications
        ? JSON.parse(existingNotifications)
        : [];
      notifications.push(notification);
      await EncryptedStorage.setItem(
        'notifications',
        JSON.stringify(notifications),
      );
      console.log('Notification stored locally:', notification);
      storeNotificationInBackend(notification);
    } catch (error) {
      console.error('Failed to store notification locally:', error);
    }
  }

  // Handle navigation based on notification data
  async function handleNotificationNavigation(remoteMessage) {
    if (!remoteMessage || !remoteMessage.data) return;

    const notificationId = remoteMessage.data.notification_id;
    const encodedNotificationId = btoa(notificationId);
    const screen = remoteMessage.data.screen;

    if (!navigationRef.current || !screen) {
      return;
    }

    console.log('Navigating based on notification to screen:', screen);

    const navigationActions = {
      UserNavigation: () =>
        navigationRef.current.dispatch(
          CommonActions.navigate('UserNavigation', {
            encodedId: encodedNotificationId,
          }),
        ),

      worktimescreen: () =>
        navigationRef.current.dispatch(
          CommonActions.navigate('ServiceInProgress', {
            encodedId: encodedNotificationId,
          }),
        ),
      Paymentscreen: () =>
        navigationRef.current.dispatch(
          CommonActions.navigate('Paymentscreen', {
            encodedId: encodedNotificationId,
          }),
        ),
      Home: () => {
        if (encodedNotificationId) {
          navigationRef.current.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [
                {
                  name: 'Tabs',
                  state: {
                    routes: [
                      {
                        name: 'Home',
                        params: {
                          encodedId: encodedNotificationId, // Pass encodedId when present
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          );
        } else {
          navigationRef.current.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [
                {
                  name: 'Tabs',
                  state: {
                    routes: [
                      {
                        name: 'Home', // Redirect without params
                      },
                    ],
                  },
                },
              ],
            }),
          );
        }
      },
    };

    if (navigationActions[screen]) {
      navigationActions[screen]();
    }
  }

  useEffect(() => {
    // Configure Push Notifications
    PushNotification.configure({
      onNotification: function (notification) {
        if (notification.userInteraction) {
          handleNotificationNavigation({data: notification.data});
        }
      },
    });

    // Request permissions and get tokens
    requestAllPermissions();
    // requestUserPermission();
    // requestNotificationPermission();
    getTokens();

    // Create notification channel
    PushNotification.createChannel(
      {
        channelId: 'default-channel-id',
        channelName: 'Default Channel',
        channelDescription: 'A default channel',
        soundName: 'default',
        importance: 4,
        vibrate: true,
      },
      created => console.log(`createChannel returned '${created}'`),
    );

    // Foreground message handler
    const unsubscribeOnMessage = messaging().onMessage(async remoteMessage => {
      console.log('A new FCM message arrived!', JSON.stringify(remoteMessage));
      await handleNotificationNavigation(remoteMessage);

      const notification = {
        title: remoteMessage.notification?.title || 'No title',
        body: remoteMessage.notification?.body || 'No body',
        data: remoteMessage.data,
        userNotificationId: remoteMessage.data.user_notification_id,
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
        channelId: 'default-channel-id',
        title: notification.title,
        message: notification.body,
        playSound: true,
        soundName: 'default',
        data: remoteMessage.data,
        userInfo: remoteMessage.data,
      });
    });

    // Background and quit state message handler
    messaging().setBackgroundMessageHandler(async remoteMessage => {
      console.log(
        'Message handled in the background!',
        JSON.stringify(remoteMessage),
      );
      await handleNotificationNavigation(remoteMessage);

      const notification = {
        title: remoteMessage.notification?.title || 'No title',
        body: remoteMessage.notification?.body || 'No body',
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

    // When the app is opened from a quit state
    messaging()
      .getInitialNotification()
      .then(async remoteMessage => {
        if (remoteMessage) {
          console.log(
            'Notification caused app to open from quit state:',
            JSON.stringify(remoteMessage),
          );
          await handleNotificationNavigation(remoteMessage);

          const notification = {
            title: remoteMessage.notification?.title || 'No title',
            body: remoteMessage.notification?.body || 'No body',
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

    // When a notification is opened from the background state
    const unsubscribeOnNotificationOpenedApp =
      messaging().onNotificationOpenedApp(async remoteMessage => {
        console.log(
          'Notification opened from background state:',
          JSON.stringify(remoteMessage),
        );
        await handleNotificationNavigation(remoteMessage);
      });

    return () => {
      unsubscribeOnMessage();
      unsubscribeOnNotificationOpenedApp();
    };
  }, []);

  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const onboarded = await EncryptedStorage.getItem('onboarded');

        if (onboarded) {
          setInitialRoute('Tabs'); // Navigate to Tabs
          navigationRef.current?.navigate('Tabs');
        } else {
          setInitialRoute('OnboardingScreen');
          navigationRef.current?.navigate('OnboardingScreen');
        }
      } catch (error) {
        console.error('Error retrieving tokens:', error);
        setInitialRoute('Login'); // Default to Login if error occurs
        navigationRef.current?.navigate('Login'); // Force navigation to Login
      }
    };

    checkOnboarding();
  }, []);

  // Show a loading screen or null until initialRoute is determined
  // if (!initialRoute) {
  //   return (
  //     <View>
  //       <ActivityIndicator size="large" color="#0000ff" />
  //     </View>
  //   );
  // }
  //
  useEffect(() => {
    SplashScreen.hide();
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen
          name="Tabs"
          component={TabNavigator}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="UserLocation"
          component={UserLocation}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="OnboardingScreen"
          component={OnboardingScreen}
          options={{headerShown: false}}
        />

        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{headerShown: false}}
        />

        <Stack.Screen
          name="OrderScreen"
          component={OrderScreen}
          options={{headerShown: false}}
        />

        <Stack.Screen
          name="DeleteAccount"
          component={AccountDelete}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="ReferralScreen"
          component={ReferralScreen}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Myrefferals"
          component={Myrefferals}
          options={{headerShown: false}}
        />

        <Stack.Screen
          name="userwaiting"
          component={WaitingUser}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="UserNavigation"
          component={Navigation}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="worktimescreen"
          component={ServiceInProgress}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Paymentscreen"
          component={Payment}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Rating"
          component={Rating}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="ServiceBooking"
          component={SingleService}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="RecentServices"
          component={RecentServices}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="serviceCategory"
          component={PaintingServices}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="SearchItem"
          component={SearchItem}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="SignupDetails"
          component={SignUpScreen}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="LocationSearch"
          component={LocationSearch}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="EditProfile"
          component={EditProfile}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="ServiceTrackingItem"
          component={ServiceTrackingItemScreen}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="serviceBookingItem"
          component={ServiceBookingItem}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Notifications"
          component={UserNotifications}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Help"
          component={HelpScreen}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="ServiceInProgress"
          component={ServiceInProgress}
          options={{headerShown: false}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default App;
