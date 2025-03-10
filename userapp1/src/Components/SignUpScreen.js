import React, {useEffect, useState} from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import axios from 'axios';
import EncryptedStorage from 'react-native-encrypted-storage';
import {useRoute, useNavigation, CommonActions} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

const SignUpScreen = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [referralCode, setReferralCode] = useState(''); // Add referral code state
  const route = useRoute();
  const navigation = useNavigation();

  const BG_IMAGE_URL =
    'https://i.postimg.cc/rFFQLGRh/Picsart-24-10-01-15-38-43-205.jpg';

  useEffect(() => {
    const {phone_number} = route.params || {};
    if (phone_number) {
      setPhoneNumber(phone_number);
    }
  }, [route.params]);

  const handleSignUp = async () => {
    try {
      const response = await axios.post(
        `http://192.168.55.102:5000/api/user/signup`,
        {
          fullName,
          email,
          phoneNumber,
          referralCode, // Send the referral code to the backend
        },
      );

      const {token, message} = response.data;
      console.log(response.data);

      if (token) {
        await EncryptedStorage.setItem('cs_token', token);
        Alert.alert(
          'Sign Up Successful',
          message || 'You have signed up successfully!',
        );
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{name: 'Tabs', state: {routes: [{name: 'Home'}]}}],
          }),
        );
      }
    } catch (error) {
      console.error('Sign up error:', error);
      Alert.alert(
        'Sign Up Failed',
        error.response?.data?.message ||
          'An error occurred during sign up. Please try again.',
      );
    }
  };

  return (
     <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoidingView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ImageBackground
            source={{uri: BG_IMAGE_URL}}
            style={styles.backgroundImage}
            resizeMode="stretch">
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}>
              <FontAwesome6 name="arrow-left-long" size={24} color="#1D2951" />
            </TouchableOpacity>

            <Text style={styles.title}>Sign Up</Text>

            <InputField
              placeholder="Full Name"
              value={fullName}
              onChangeText={setFullName}
            />

            <InputField
              placeholder="Email Address"
              value={email}
              onChangeText={setEmail}
              icon={<Icon name="envelope" size={20} color="#1D2951" />}
              keyboardType="email-address"
            />

            <InputField
              placeholder="Referral Code (Optional)"
              value={referralCode}
              onChangeText={setReferralCode}
              icon={<FontAwesome6 name="gift" size={20} color="#1D2951" />}
            />

            <TouchableOpacity style={styles.button} onPress={handleSignUp}>
              <Text style={styles.buttonText}>Sign Up</Text>
            </TouchableOpacity>
          </ImageBackground>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
};

const InputField = ({placeholder, value, onChangeText, icon, keyboardType}) => (
  <View style={styles.inputContainer}>
    {icon && <View style={styles.iconContainer}>{icon}</View>}
    <TextInput
      style={styles.input}
      placeholder={placeholder}
      value={value}
      onChangeText={onChangeText}
      placeholderTextColor="#999"
      keyboardType={keyboardType}
    />
  </View>
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  }, 
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  keyboardAvoidingView: {flex: 1},
  backgroundImage: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  backButton: {
    position: 'absolute',
    top: 20,
    left: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#1D2951',
  },
  inputContainer: {
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    borderColor: '#ccc',
    borderWidth: 1,
    marginBottom: 20,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    marginHorizontal: '15%',
  },
  iconContainer: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  button: {
    backgroundColor: '#FF5722',
    paddingVertical: 11,
    width: '50%',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    marginTop: 25,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default SignUpScreen;
