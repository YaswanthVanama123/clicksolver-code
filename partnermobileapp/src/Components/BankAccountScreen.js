import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  Dimensions,
} from 'react-native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import EncryptedStorage from 'react-native-encrypted-storage';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';

const BankAccountScreen = () => {
  // State variables for bank details
  const [bank, setBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [errors, setErrors] = useState({});
  const navigation = useNavigation();

  // Basic field validation
  const validateFields = () => {
    const newErrors = {};
    if (!bank) newErrors.bank = 'Bank Name is required.';
    if (!accountNumber) newErrors.accountNumber = 'Account Number is required.';
    if (!confirmAccountNumber)
      newErrors.confirmAccountNumber = 'Confirm Account Number is required.';
    if (!ifscCode) newErrors.ifscCode = 'IFSC CODE is required.';
    if (!accountHolderName)
      newErrors.accountHolderName = "Account Holder's Name is required.";
    if (accountNumber && confirmAccountNumber && accountNumber !== confirmAccountNumber) {
      newErrors.confirmAccountNumber = 'Account numbers do not match.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handler for adding bank account
  const handleAddBankAccount = async () => {
    if (!validateFields()) return;

    try {
      // Retrieve worker's authentication token
      const pcsToken = await EncryptedStorage.getItem('pcs_token');
      if (!pcsToken) {
        console.error("No pcs_token found.");
        navigation.replace("Login");
        return;
      }

      // In production, you should fetch the worker's Razorpay contact_id from your backend.
      // For this demo, we use a placeholder.
  // Replace with the actual contact_id

      // Build payload for fund account creation
      const fundAccountDetails = {
  
        name: accountHolderName,   // Account holder's name to be used in Razorpay fund account creation
        ifsc: ifscCode,
        account_number: accountNumber,
        bank_name: bank,
      };

      // Call the backend API that creates a fund account via Razorpay.
      // Make sure your backend endpoint is set up to call Razorpay's /v1/fund_accounts API.
      const response = await axios.post(
        "http://192.168.55.102:5000/api/account/fund_account",
        fundAccountDetails,
        { headers: { Authorization: `Bearer ${pcsToken}` } }
      );

      if (response.data.success) {
        Alert.alert("Success", "Bank account verified and added successfully!");
        navigation.replace("PartnerSteps");
      } else {
        Alert.alert("Error", response.data.message || "Verification failed.");
      }
    } catch (error) {
      console.error("Error creating fund account:", error.response?.data || error.message);
      Alert.alert("Error", "Failed to create fund account. Please check your details.");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <FontAwesome6
              name="arrow-left-long"
              size={20}
              color="#9e9e9e"
              style={styles.leftIcon}
            />
          </View>
          <View>
            <Ionicons name="help-circle-outline" size={25} color="#9e9e9e" />
          </View>
        </View>
        <Text style={styles.bankAccountDetailsText}>Bank account details</Text>
        {/* Form */}
        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, errors.bank && { borderBottomColor: '#ff4500' }]}
              placeholder="Bank Name"
              placeholderTextColor="#9e9e9e"
              value={bank}
              onChangeText={text => {
                setBank(text);
                if (errors.bank) setErrors(prev => ({ ...prev, bank: null }));
              }}
            />
            {errors.bank && <Text style={styles.errorText}>{errors.bank}</Text>}
          </View>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, errors.accountNumber && { borderBottomColor: '#ff4500' }]}
              placeholder="Account number"
              placeholderTextColor="#9e9e9e"
              keyboardType="numeric"
              value={accountNumber}
              onChangeText={text => {
                setAccountNumber(text);
                if (errors.accountNumber)
                  setErrors(prev => ({ ...prev, accountNumber: null }));
              }}
            />
            {errors.accountNumber && (
              <Text style={styles.errorText}>{errors.accountNumber}</Text>
            )}
          </View>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, errors.confirmAccountNumber && { borderBottomColor: '#ff4500' }]}
              placeholder="Confirm Account number"
              placeholderTextColor="#9e9e9e"
              keyboardType="numeric"
              value={confirmAccountNumber}
              onChangeText={text => {
                setConfirmAccountNumber(text);
                if (accountNumber && text !== accountNumber) {
                  setErrors(prev => ({ ...prev, confirmAccountNumber: 'Account numbers do not match.' }));
                } else {
                  setErrors(prev => ({ ...prev, confirmAccountNumber: null }));
                }
              }}
            />
            {errors.confirmAccountNumber && (
              <Text style={styles.errorText}>{errors.confirmAccountNumber}</Text>
            )}
          </View>
          <View style={styles.inputContainer}>
            <TextInput
              style={[styles.input, errors.ifscCode && { borderBottomColor: '#ff4500' }]}
              placeholder="IFSC CODE"
              placeholderTextColor="#9e9e9e"
              value={ifscCode}
              onChangeText={text => {
                setIfscCode(text);
                if (errors.ifscCode)
                  setErrors(prev => ({ ...prev, ifscCode: null }));
              }}
            />
            {errors.ifscCode && (
              <Text style={styles.errorText}>{errors.ifscCode}</Text>
            )}
          </View>
          <View style={styles.lastInputContainer}>
            <TextInput
              style={[styles.input, errors.accountHolderName && { borderBottomColor: '#ff4500' }]}
              placeholder="Account holder's name"
              placeholderTextColor="#9e9e9e"
              value={accountHolderName}
              onChangeText={text => {
                setAccountHolderName(text);
                if (errors.accountHolderName)
                  setErrors(prev => ({ ...prev, accountHolderName: null }));
              }}
            />
            {errors.accountHolderName && (
              <Text style={styles.errorText}>{errors.accountHolderName}</Text>
            )}
          </View>
          <Text style={styles.helpText}>
            Need help finding these numbers?{' '}
            <Text style={styles.learnMoreText}>Learn more</Text>
          </Text>
          <Text style={styles.acceptTerms}>
            By adding this bank account, I agree to PayMe T& Cs regarding topping up from bank account.
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleAddBankAccount}>
            <Text style={styles.buttonText}>Add bank account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const screenHeight = Dimensions.get('window').height;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  inputContainer: {
    marginBottom: 40,
  },
  lastInputContainer: {
    marginBottom: 20,
  },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    paddingVertical: 3,
    fontSize: 15,
    color: '#747676',
  },
  errorText: {
    color: '#ff4500',
    fontSize: 14,
    marginBottom: 10,
  },
  learnMoreText: {
    color: '#212121',
    fontWeight: 'bold',
    paddingLeft: 5,
  },
  acceptTerms: {
    color: '#212121',
    paddingBottom: 20,
    fontWeight: '600',
  },
  container: {
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: '#fafafa',
  },
  bankAccountDetailsText: {
    paddingTop: 15,
    paddingBottom: 40,
    fontWeight: 'bold',
    color: '#212121',
    fontSize: 23,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  helpText: {
    color: '#9e9e9e',
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#FF5722',
    paddingVertical: 12,
    borderRadius: 22,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default BankAccountScreen;
