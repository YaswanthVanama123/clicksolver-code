import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import axios from 'axios';
import EncryptedStorage from 'react-native-encrypted-storage';
import { useNavigation, CommonActions, useRoute } from '@react-navigation/native';
import Entypo from 'react-native-vector-icons/Entypo';
import { useTheme } from '../context/ThemeContext';

const VerificationScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  // Extract phoneNumber, verificationId and optional serviceName, id from route params
  const { phoneNumber, verificationId, serviceName, id } = route.params;
  const { width, height } = useWindowDimensions();
  const { isDarkMode } = useTheme();
  const styles = dynamicStyles(width, height, isDarkMode);

  const [timer, setTimer] = useState(120); // 2 minutes timer
  const [code, setCode] = useState(['', '', '', '']);
  const [loading, setLoading] = useState(false);

  // Create refs for each OTP TextInput
  const inputs = useRef([]);

  useEffect(() => {
    const countdown = setInterval(() => {
      setTimer((prevTimer) => (prevTimer > 0 ? prevTimer - 1 : 0));
    }, 1000);
    return () => clearInterval(countdown);
  }, []);

  const formattedTime = () => {
    const minutes = Math.floor(timer / 60);
    const seconds = timer % 60;
    return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
  };

  const submitOtp = async () => {
    const otpCode = code.join('');
    if (otpCode.length < 4) {
      alert('Please enter the complete 4-digit OTP');
      return;
    }
    setLoading(true);
    try {
      const validateResponse = await axios.get(
        'https://backend.clicksolver.com/api/validate',
        { 
          params: {
            mobileNumber: phoneNumber,
            verificationId,
            otpCode,
          },
        }
      );
      if (validateResponse.data.message === 'OTP Verified') {
        // console.log("OTP verified");
        const loginResponse = await axios.post(
          'https://backend.clicksolver.com/api/user/login',
          { phone_number: phoneNumber }
        );
        // console.log("Login response status:", loginResponse.status);
        if (loginResponse.status === 200) {
          const { token } = loginResponse.data;
          await EncryptedStorage.setItem('cs_token', token);
          // If optional serviceName and id are provided, navigate to SingleService; otherwise, to Home
          if (serviceName && id) {
            navigation.replace('ServiceBooking', { serviceName, id });
                      // navigation.dispatch(
                      //   CommonActions.reset({
                      //     index: 0,
                      //     routes: [
                      //       {name: 'ServiceBooking', params: {serviceName,id}},
                      //     ],
                      //   }),
                      // );
          } else {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [
                  {
                    name: 'Tabs',
                    state: {
                      routes: [{ name: 'Home' }],
                    },
                  },
                ],
              })
            );
          }
        } else if (loginResponse.status === 205) {
          // When navigating to SignUpScreen, also send optional serviceName and id if available
          navigation.navigate('SignUpScreen', {
            phone_number: phoneNumber,
            ...(serviceName && id ? { serviceName, id } : {}),
          });
        }
      } else {
        alert('Invalid OTP, please try again.');
      }
    } catch (error) {
      console.error('Error during OTP validation or login:', error);
      alert('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle text change for each OTP input
  const handleChangeText = (value, index) => {
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    if (value && index < newCode.length - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  // Handle key press for backspace to navigate between inputs
  const handleKeyPress = ({ nativeEvent }, index) => {
    if (nativeEvent.key === 'Backspace' && code[index] === '' && index > 0) {
      inputs.current[index - 1]?.focus();
      const newCode = [...code];
      newCode[index - 1] = '';
      setCode(newCode);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoidingView}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.mainContainer}>
        {/* Background Image */}
        <Image
          source={{
            uri: 'https://i.postimg.cc/zB1C8frj/Picsart-24-10-01-15-26-57-512-1.jpg',
          }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="stretch"
        />

        {/* Foreground Content */}
        <View style={styles.container}>
          <Text style={styles.title}>Verification Code</Text>
          <Text style={styles.instruction}>
            Please enter the 4-digit code sent on
          </Text>
          <Text style={styles.number}>{phoneNumber}</Text>

          <View style={styles.codeContainer}>
            {code.map((digit, index) => (
              <TextInput
                key={index}
                style={styles.codeInput}
                keyboardType="numeric"
                maxLength={1}
                value={digit}
                autoFocus={index === 0}
                ref={(ref) => (inputs.current[index] = ref)}
                onChangeText={(value) => handleChangeText(value, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
              />
            ))}
          </View>

          <Text style={styles.timer}>{formattedTime()}</Text>

          <TouchableOpacity
            style={styles.submitButton}
            onPress={submitOtp}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit</Text>
            )}
          </TouchableOpacity>

          <View style={styles.contactContainer}>
            <Text style={styles.contactText}>Contact us:</Text>
            <View style={styles.socialIcons}>
              <Entypo name="mail" size={15} color={isDarkMode ? '#fff' : "#9e9e9e"} />
              <Entypo name="facebook" size={15} color={isDarkMode ? '#fff' : "#9e9e9e"} />
              <Entypo name="instagram" size={15} color={isDarkMode ? '#fff' : "#9e9e9e"} />
            </View>
            <Text style={styles.email}>customer.support@clicksolver.com</Text>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

/**
 * DYNAMIC STYLES with Dark Mode Support
 */
const dynamicStyles = (width, height, isDarkMode) => {
  const isTablet = width >= 600;
  return StyleSheet.create({
    keyboardAvoidingView: {
      flex: 1,
    },
    mainContainer: {
      flex: 1,
    },
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: isTablet ? 30 : 20,
    },
    title: {
      fontSize: isTablet ? 26 : 22,
      fontWeight: 'bold',
      marginBottom: isTablet ? 25 : 20,
      color: isDarkMode ? '#fff' : '#212121',
    },
    instruction: {
      fontSize: isTablet ? 18 : 16,
      textAlign: 'center',
      color: isDarkMode ? '#ccc' : '#9e9e9e',
    },
    number: {
      fontSize: isTablet ? 18 : 16,
      textAlign: 'center',
      marginBottom: isTablet ? 35 : 30,
      color: isDarkMode ? '#ccc' : '#212121',
      fontWeight: 'bold',
    },
    codeContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      width: '80%',
      marginBottom: isTablet ? 25 : 20,
      gap: isTablet ? 15 : 10,
    },
    codeInput: {
      borderWidth: 1,
      borderColor: isDarkMode ? '#fff' : '#ccc',
      borderRadius: 10,
      width: isTablet ? 55 : 45,
      height: isTablet ? 55 : 45,
      textAlign: 'center',
      fontSize: isTablet ? 20 : 18,
      color: isDarkMode ? '#fff' : '#212121',
      backgroundColor: isDarkMode ? '#333' : '#fff', // Added background color
    },
    timer: {
      fontSize: isTablet ? 20 : 18,
      fontWeight: '800',
      marginBottom: isTablet ? 25 : 20,
      color: isDarkMode ? '#fff' : '#212121',
    },
    submitButton: {
      backgroundColor: '#ff6c37',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: isTablet ? 18 : 15,
      paddingHorizontal: isTablet ? 50 : 40,
      borderRadius: 10,
      marginBottom: isTablet ? 50 : 40,
      width: isTablet ? 180 : 150,
    },
    submitButtonText: {
      color: '#fff',
      fontSize: isTablet ? 18 : 16,
      fontWeight: 'bold',
    },
    contactContainer: {
      alignItems: 'center',
    },
    contactText: {
      fontSize: isTablet ? 18 : 16,
      marginBottom: isTablet ? 15 : 10,
      color: isDarkMode ? '#fff' : '#212121',
    },
    socialIcons: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 5,
      marginBottom: isTablet ? 15 : 10,
    },
    email: {
      fontSize: isTablet ? 14 : 12,
      color: isDarkMode ? '#fff' : '#9e9e9e',
      paddingBottom: isTablet ? 40 : 30,
    },
  });
};

export default VerificationScreen;
 