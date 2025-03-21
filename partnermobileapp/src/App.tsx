import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, SafeAreaView, ActivityIndicator, View, Appearance, Platform } from 'react-native';
import { NavigationContainer, CommonActions, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import messaging from '@react-native-firebase/messaging';
import axios from 'axios';
import EncryptedStorage from 'react-native-encrypted-storage';
import SplashScreen from 'react-native-splash-screen';
import Feather from 'react-native-vector-icons/Feather';
import Entypo from 'react-native-vector-icons/Entypo';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';

// Import react-native-permissions functions and constants
import { request, PERMISSIONS, requestNotifications } from 'react-native-permissions';

// Import your components/screens
import RecentServices from './Components/RecentServices';
import Profile from './Components/Profile';
import PartnerSteps from './Components/PartnerSteps';
import LoginScreen from './Components/LoginScreen';
import RegistrationScreen from './Components/RegistrationScreen';
import HelloWorld from './Screens/HelloWorld';
import UPIIdDetailsScreen from './Components/UPIIdDetailsScreen';
import BankAccountScreen from './Components/BankAccountScreen';
import BalanceScreen from './Screens/BalanceScreen';
import RatingsScreen from './Components/ratingsScreen';
import EarningsScreen from './Screens/EarningsScreen';
import TaskConfirmation from './Components/TaskConfirmation';
import ServiceCompletionScreen from './Components/ServiceCompletionScreen';
import PaymentScanner from './Components/PaymentScanner';
import OTPVerification from './Components/OtpVerification';
import WorkerTimer from './Components/WorkerTimer';
import WorkerNavigationScreen from './Components/WorkerNavigationScreen';
import WorkerAcceptance from './Components/Acceptance';
import SignUpScreen from './Components/SignUpScreen';
import skills from './Components/Skills';
import ServiceTrackingListScreen from './Components/ServiceTrackingListScreen';
import ServiceTrackingItemScreen from './Components/ServiceTrackingItemScreen';
import TrackingConfirmation from './Components/TrackingConfirmation';
import Approval from './Components/Approval';
import IndividualWorkerPending from './Components/IndividualWorkerPending';
import ServiceBookingItem from './Components/ServiceBookingItem';
import CashbackScreen1 from './Components/CashbackScreen1';
import PendingCashbackWorkers from './Components/PendingCashbackWorkers';
import AdministratorDashboard from './Components/AdministratorDashboard';
import AdministratorAllTrackings from './Components/AdministratorAllTrackings';
import ApprovalPendingItems from './Components/ApprovalPendingItems';
import PendingBalanceWorkers from './Components/PendingBalanceWorkers';
import ServiceInProgress from './Components/ServiceInProgress';
import ServiceRegistration from './Components/ServiceRegistration';
import TaskCompletionScreen from './Components/TaskConformationScreen';
import HomeScreen from './Screens/Home';
import HomeComponent from './Screens/HomeComponent';
import WorkerOtpVerificationScreen from './Components/WorkerOtpVerificationScreen';
import ProfileChange from './Components/ProfileChange';
import PaymentConfirmationScreen from './Components/PaymentConfirmationScreen';

// Import the ThemeProvider and hook
import { ThemeProvider, useTheme } from './context/ThemeContext';
import ServiceBookingOngoingItem from './Components/ServiceBookingOngoingItem';
import ChatScreen from './Components/ChatScreen';

// Define your Stack and Tab navigators
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabNavigator() {
  const { isDarkMode } = useTheme();
  const tabBarBackground = isDarkMode ? '#333' : '#fff';

  return (
    <SafeAreaView style={styles.container}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName;
            size = focused ? 28 : 24; // Slight size change when active

            if (route.name === 'Home') {
              iconName = 'home';
              return <Feather name={iconName} size={size} color={color} />;
            } else if (route.name === 'Bookings') {
              iconName = 'clipboard';
              return <Feather name={iconName} size={size} color={color} />;
            } else if (route.name === 'Tracking') {
              iconName = 'wallet';
              return <Entypo name={iconName} size={size} color={color} />;
            } else if (route.name === 'Account') {
              iconName = 'account-outline';
              return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
            }
          },
          tabBarActiveTintColor: '#ff4500',
          tabBarInactiveTintColor: 'gray',
          tabBarLabelStyle: {
            fontSize: 12,
          },
          tabBarStyle: {
            height: 60,
            paddingBottom: 5,
            paddingTop: 5,
            backgroundColor: tabBarBackground,
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Bookings" component={RecentServices} options={{ headerShown: false }} />
        <Tab.Screen name="Tracking" component={ServiceTrackingListScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Account" component={skills} options={{ headerShown: false }} />
      </Tab.Navigator>
    </SafeAreaView>
  );
}

function AppContent() {
  const navigationRef = useRef<NavigationContainerRef>(null);
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const { isDarkMode } = useTheme();

  // Handler for force logout
  const handleForceLogout = async () => {
    try {
      console.log("Logging out due to session expiration...");
      const fcm_token = await EncryptedStorage.getItem('fcm_token');
      console.log("fcm token", fcm_token);
      if (fcm_token) {
        await axios.post('https://backend.clicksolver.com/api/workerLogout', { fcm_token });
      }
      await EncryptedStorage.removeItem("pcs_token");
      await EncryptedStorage.removeItem("fcm_token");
      await EncryptedStorage.removeItem("unique");
      await EncryptedStorage.removeItem("firebaseDocId");
      await EncryptedStorage.removeItem("nullCoordinates");
      await EncryptedStorage.removeItem("previousEnabled");
      await EncryptedStorage.removeItem("workerSessionToken");

      navigationRef.current?.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: "Login" }],
        })
      );
    } catch (error) {
      console.error("Error handling force logout:", error);
    }
  };

  // Check session on app start
  useEffect(() => {
    const checkSessionOnAppStart = async () => {
      try {
        const pcsToken = await EncryptedStorage.getItem("pcs_token");
        if (!pcsToken) {
          console.warn("No PCS token found, logging out...");
          handleForceLogout();
          return;
        }
        const response = await axios.post(
          "https://backend.clicksolver.com/api/worker/token/verification",
          { pcsToken },
          { headers: { Authorization: `Bearer ${pcsToken}` } }
        );
        if (response.status === 205) {
          console.warn("Session expired, logging out...");
          handleForceLogout();
        } else {
          console.log("Session valid, continuing...");
        }
      } catch (error) {
        console.error("Error checking session validity:", error);
      }
    };
    checkSessionOnAppStart();
  }, []);

  // Set up permission and notification handlers
  // Set up permission and notification handlers
  useEffect(() => {
    const requestPermissions = async () => {
      try {
        // Request notifications permission using react-native-permissions
        const { status: notifStatus } = await requestNotifications(['alert', 'sound', 'badge']);
        console.log('Notifications permission status:', notifStatus);

        let locationStatus;

        if (Platform.OS === 'ios') {
          // First request LOCATION_WHEN_IN_USE
          const whenInUseStatus = await request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
          console.log('Location When In Use permission status:', whenInUseStatus);
          if (whenInUseStatus === 'granted') {
            // Now request LOCATION_ALWAYS
            locationStatus = await request(PERMISSIONS.IOS.LOCATION_ALWAYS);
            console.log('Location Always permission status:', locationStatus);
          } else {
            console.warn('Location When In Use permission was not granted');
          }
        } else {
          // For Android, first request ACCESS_FINE_LOCATION
          const fineLocationStatus = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
          console.log('Fine Location permission status:', fineLocationStatus);
          if (fineLocationStatus === 'granted') {
            // Then request ACCESS_BACKGROUND_LOCATION
            locationStatus = await request(PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION);
            console.log('Background Location permission status:', locationStatus);
          } else {
            console.warn('Fine Location permission was not granted');
          }
        }

        // Request physical activity permission

      } catch (err) {
        console.warn('Error requesting permissions:', err);
      }
    };

    const handleForegroundNotification = () => {
      messaging().onMessage(async remoteMessage => {
        const notificationId = remoteMessage.data?.notification_id;
        const screen = remoteMessage.data?.screen;

        if (!navigationRef.current) {
          console.warn('Navigation reference is not set yet.');
          return;
        }

        if (screen === 'Home') {
          navigationRef.current.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'Tabs', state: { routes: [{ name: 'Home' }] } }],
            })
          );
        } else if (screen === 'TaskConfirmation') {
          navigationRef.current.navigate('TaskConfirmation', {
            encodedId: notificationId,
          });
        } else if (remoteMessage.data?.action === "FORCE_LOGOUT") {
          handleForceLogout();
        }
      });
    };

    const handleBackgroundNotification = () => {
      messaging().setBackgroundMessageHandler(async remoteMessage => {
        const notificationId = remoteMessage.data?.notification_id;
        const screen = remoteMessage.data?.screen;

        if (!navigationRef.current) {
          console.warn('Navigation reference is not set yet.');
          return;
        }

        if (screen === 'Home') {
          navigationRef.current.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'Home' }],
            })
          );
        } else if (screen === 'TaskConfirmation') {
          navigationRef.current.navigate('TaskConfirmation', {
            encodedId: notificationId,
          });
        } else if (remoteMessage.data?.action === "FORCE_LOGOUT") {
          handleForceLogout();
        }
      });
    };

    const handleInitialNotification = async () => {
      const remoteMessage = await messaging().getInitialNotification();
      const screen = remoteMessage?.data?.screen;

      if (!navigationRef.current) {
        console.warn('Navigation reference is not set yet.');
        return;
      }

      if (screen === 'Home') {
        navigationRef.current.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Tabs', state: { routes: [{ name: 'Home' }] } }],
          })
        );
      } else if (screen === 'TaskConfirmation') {
        navigationRef.current.navigate('TaskConfirmation', {
          encodedId: remoteMessage?.data?.notification_id,
        });
      } else if (remoteMessage?.data?.action === "FORCE_LOGOUT") {
        handleForceLogout();
      }
    };

    const setupHandlers = async () => {
      await requestPermissions();
      handleForegroundNotification();
      handleBackgroundNotification();
      handleInitialNotification();
    };

    setupHandlers();
    SplashScreen.hide();
  }, []);


  // Check partner steps status
  useEffect(() => {
    const checkPartnerStepsStatus = async () => {
      try {
        const pcsToken = await EncryptedStorage.getItem('pcs_token');
        if (pcsToken) {
          const partnerStepsToken = await EncryptedStorage.getItem('partnerSteps');
          const verification = await EncryptedStorage.getItem('verification');

          if (partnerStepsToken === 'completed') {
            if (verification === 'true') {
              setInitialRoute('Tabs');
              navigationRef.current?.navigate('Tabs');
            } else {
              setInitialRoute('ApprovalScreen');
              navigationRef.current?.navigate('ApprovalScreen');
            }
          } else {
            setInitialRoute('PartnerSteps');
            navigationRef.current?.navigate('PartnerSteps');
          }
        } else {
          setInitialRoute('Login');
          navigationRef.current?.navigate('Login');
        }
      } catch (error) {
        console.error('Error retrieving tokens:', error);
        setInitialRoute('Login');
        navigationRef.current?.navigate('Login');
      }
    };

    checkPartnerStepsStatus();
  }, []);

  // Show a loading screen until initialRoute is determined
  if (!initialRoute) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  const appBackground = isDarkMode ? '#000' : '#fff';

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
        <Stack.Screen name="PartnerSteps" component={PartnerSteps} options={{ title: 'PartnerSteps', headerShown: false }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Login', headerShown: false }} />
        <Stack.Screen name="SkillRegistration" component={RegistrationScreen} options={{ title: 'SkillRegistration', headerShown: false }} />
        <Stack.Screen name="Acceptance" component={WorkerAcceptance} options={{ title: 'Acceptance' }} />
        <Stack.Screen name="ServiceRegistration" component={ServiceRegistration} options={{ title: 'ServiceRegistration', headerShown: false }} />
        <Stack.Screen name="UserNavigation" component={WorkerNavigationScreen} options={{ title: 'UserNavigation', headerShown: false }} />
        <Stack.Screen name="worktimescreen" component={ServiceInProgress} options={{ title: 'worktimescreen', headerShown: false }} />
        <Stack.Screen name="OtpVerification" component={OTPVerification} options={{ title: 'OtpVerification', headerShown: false }} />
        <Stack.Screen name="PaymentConfirmationScreen" component={PaymentConfirmationScreen} options={{ title: 'PaymentConfirmationScreen', headerShown: false }} />
        <Stack.Screen name="Paymentscreen" component={PaymentScanner} options={{ title: 'Paymentscreen', headerShown: false }} />
        <Stack.Screen name="ServiceCompleted" component={ServiceCompletionScreen} options={{ title: 'PaymentCompleted', headerShown: false }} />
        <Stack.Screen name="TaskConfirmation" component={TaskConfirmation} options={{ title: 'TaskConfirmation', headerShown: false }} />
        <Stack.Screen name="Profile" component={Profile} options={{ title: 'Profile' }} />
        <Stack.Screen name="Earnings" component={EarningsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="RatingsScreen" component={RatingsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="BalanceScreen" component={BalanceScreen} options={{ headerShown: false }} />
        <Stack.Screen name="BankAccountScreen" component={BankAccountScreen} options={{ title: 'BankAccountScreen', headerShown: false }} />
        <Stack.Screen name="WorkerOtpVerificationScreen" component={WorkerOtpVerificationScreen} options={{ title: 'WorkerOtpVerificationScreen', headerShown: false }} />
        <Stack.Screen name="SignupDetails" component={SignUpScreen} options={{ title: 'SignupDetails', headerShown: false }} />
        <Stack.Screen name="UpiIDScreen" component={UPIIdDetailsScreen} options={{ title: 'UpiIDScreen', headerShown: false }} />
        <Stack.Screen name="ApprovalScreen" component={Approval} options={{ title: 'Approval', headerShown: false }} />
        <Stack.Screen name="ServiceTrackingItem" component={ServiceTrackingItemScreen} options={{ title: 'ServiceTrackingItem', headerShown: false }} />
        <Stack.Screen name="TrackingConfirmation" component={TrackingConfirmation} options={{ title: 'TrackingConfirmation', headerShown: false }} />
        <Stack.Screen name="IndividualWorkerPending" component={IndividualWorkerPending} options={{ title: 'IndividualWorkerPending', headerShown: false }} />
        <Stack.Screen name="WorkerProfile" component={ProfileChange} options={{ title: 'WorkerProfile', headerShown: false }} />
        <Stack.Screen name="serviceBookingItem" component={ServiceBookingItem} options={{ title: 'serviceBookingItem', headerShown: false }} />
        <Stack.Screen name="WorkerPendingCashback" component={CashbackScreen1} options={{ title: 'WorkerPendingCashback', headerShown: false }} />
        <Stack.Screen name="AdministratorAllTrackings" component={AdministratorAllTrackings} options={{ title: 'AdministratorAllTrackings', headerShown: false }} />
        <Stack.Screen name="AdministratorDashboard" component={AdministratorDashboard} options={{ title: 'AdministratorDashboard', headerShown: false }} />
        <Stack.Screen name="ApprovalPendingItems" component={ApprovalPendingItems} options={{ title: 'ApprovalPendingItems', headerShown: false }} />
        <Stack.Screen name="PendingCashbackWorkers" component={PendingCashbackWorkers} options={{ title: 'PendingCashbackWorkers', headerShown: false }} />
        <Stack.Screen name="PendingBalanceWorkers" component={PendingBalanceWorkers} options={{ title: 'PendingBalanceWorkers', headerShown: false }} />
        <Stack.Screen name="ProfileChange" component={ProfileChange} options={{ title: 'ProfileChange', headerShown: false }} />
        <Stack.Screen name="ServiceInProgress" component={ServiceInProgress} options={{ title: 'ServiceInProgress', headerShown: false }} />
        <Stack.Screen name="ServiceBookingOngoingItem" component={ServiceBookingOngoingItem} options={{ title: 'ServiceBookingOngoingItem', headerShown: false }} />
        <Stack.Screen name="ChatScreen" component={ChatScreen} options={{ title: 'ServiceBookingOngoingItem', headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function App() {
  const { isDarkMode } = useTheme();
  const appBackground = isDarkMode ? '#000' : '#fff';

  return (
    <View style={[styles.appContainer, { backgroundColor: appBackground }]}>
      <AppContent />
    </View>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default function Root() {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}
