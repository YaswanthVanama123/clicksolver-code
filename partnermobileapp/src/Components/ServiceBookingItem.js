import React, {useEffect, useState, useMemo, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome6';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation, CommonActions, useRoute} from '@react-navigation/native';
import axios from 'axios';

const ServiceBookingItem = () => {
  const [details, setDetails] = useState({});
  const [paymentDetails, setPaymentDetails] = useState({});
  const [serviceArray, setServiceArray] = useState([]);
  const {tracking_id} = useRoute().params;
  const navigation = useNavigation();

  // Status object with timestamps
  const [status, setStatus] = useState({
    accept: '2024-11-02 22:16:22',
    arrived: '2024-11-02 22:16:32',
    workCompleted: '2024-11-02 22:16:48',
    paymentCompleted: '2024-11-02 22:16:56',
  });

  // Status display names mapping
  const statusDisplayNames = {
    accept: 'Commander Accepted',
    arrived: 'Commander Arrived',
    workCompleted: 'Work Completed',
    paymentCompleted: 'Payment Completed',
  };

  // Timeline data generation based on status object
  const getTimelineData = useMemo(() => {
    const statusKeys = Object.keys(status);
    const currentStatusIndex = statusKeys.findIndex(
      key => status[key] === null,
    );

    return statusKeys.map((statusKey, index) => ({
      title: statusDisplayNames[statusKey],
      time: status[statusKey],
      iconColor:
        index <= currentStatusIndex || currentStatusIndex === -1
          ? '#ff4500'
          : '#a1a1a1',
      lineColor:
        index <= currentStatusIndex || currentStatusIndex === -1
          ? '#ff4500'
          : '#a1a1a1',
    }));
  }, [status]);

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const response = await axios.post(
          `https://backend.clicksolver.com/api/service/booking/item/details`,
          {tracking_id},
        );
        const {data, paymentDetails} = response.data;
        setStatus(data.time || {});
        setDetails(data);
        setPaymentDetails(paymentDetails);
        setServiceArray(data.service_booked);
      } catch (error) {
        console.error('Error fetching bookings data:', error);
      }
    };
    fetchBookings();
  }, [tracking_id]);

  const openPhonePeScanner = useCallback(() => {
    const url = 'phonepe://scan';
    Linking.openURL(url)
      .then(() => {
        console.log('PhonePe scanner opened successfully');
      })
      .catch(err => {
        console.error('Failed to open PhonePe scanner:', err);
        Linking.openURL(
          'https://play.google.com/store/apps/details?id=com.phonepe.app',
        );
      });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon
          name="arrow-left-long"
          size={20}
          color="#212121"
          style={styles.backIcon}
        />
        <Text style={styles.headerText}>Service Trackings</Text>
      </View>
      <ScrollView>
        {/* User Profile */}
        <View style={styles.profileContainer}>
          <View style={styles.profileImage}>
            <Text style={styles.profileInitial}>
              {details.name ? details.name.charAt(0).toUpperCase() : ''}
            </Text>
          </View>
          <View style={styles.profileTextContainer}>
            <View>
              <Text style={styles.userName}>{details.name}</Text>
              <Text style={styles.userDesignation}>{details.service}</Text>
            </View>
          </View>
        </View>

        <View style={styles.horizantalLine} />

        {/* Service Details */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionBookedTitle}>Service Details</Text>
          <View style={styles.innerContainer}>
            {serviceArray.map((service, index) => (
              <Text key={index} style={styles.serviceDetail}>
                {service.serviceName}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.horizantalLine} />

        {/* Service Timeline */}
        <View style={styles.sectionContainer}>
          <View style={styles.serviceTimeLineContainer}>
            <Text style={styles.sectionTitle}>Service Timeline</Text>
          </View>
          <View style={styles.innerContainerLine}>
            {getTimelineData.map((item, index) => (
              <View key={index} style={styles.timelineItem}>
                <View style={{alignItems: 'center'}}>
                  <MaterialCommunityIcons
                    name="circle"
                    size={14}
                    color={item.iconColor}
                    style={styles.timelineIcon}
                  />
                  {index !== getTimelineData.length - 1 && (
                    <View
                      style={[
                        styles.lineSegment,
                        {backgroundColor: getTimelineData[index + 1].iconColor},
                      ]}
                    />
                  )}
                </View>
                <View style={styles.timelineTextContainer}>
                  <Text style={styles.timelineText}>{item.title}</Text>
                  <Text style={styles.timelineTime}>
                    {item.time ? item.time : 'Pending'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.horizantalLine} />

        {/* Address */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>Address</Text>
          <View style={styles.addressContainer}>
            <Image
              source={{
                uri: 'https://i.postimg.cc/qvJw8Kzy/Screenshot-2024-11-13-170828-removebg-preview.png',
              }}
              style={styles.locationPinImage}
            />
            <View style={styles.addressTextContainer}>
              <Text style={styles.address}>{details.area}</Text>
            </View>
          </View>
        </View>

        {/* Payment Details */}
        <View style={styles.paymentInnerContainer}>
          <Text style={styles.sectionPaymentTitle}>Payment Details</Text>
        </View>
        <View style={styles.sectionContainer}>
          <View style={styles.PaymentItemContainer}>
            {serviceArray.map((service, index) => (
              <View key={index} style={styles.paymentRow}>
                <Text style={styles.paymentLabel}>{service.serviceName}</Text>
                <Text style={styles.paymentValue}>₹{service.cost}.00</Text>
              </View>
            ))}
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>SGST (5%)</Text>
              <Text style={styles.paymentValue}>
                ₹{paymentDetails.cgstAmount}.00
              </Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>CGST (5%)</Text>
              <Text style={styles.paymentValue}>
                ₹{paymentDetails.gstAmount}.00
              </Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Cashback (5%)</Text>
              <Text style={styles.paymentValue}>
                ₹{paymentDetails.discountAmount}.00
              </Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Pay Via Scan</Text>
              <Text style={styles.paymentValue}>
                Grand Total ₹{paymentDetails.fetchedFinalTotalAmount}.00
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.payButton} onPress={openPhonePeScanner}>
          <Text style={styles.payButtonText}>PAYED</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 12,
    elevation: 2,
    shadowColor: '#1D2951',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    backgroundColor: '#ffffff',
  },
  backIcon: {
    marginRight: 10,
  },
  headerText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1D2951',
    paddingLeft: 30,
  },
  profileCallContainer: {
    flexDirection: 'row',

    justifyContent: 'space-between',
  },
  profileImage: {
    width: 60,
    height: 60,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FF7A22',
    borderRadius: 30,
    marginRight: 5,
  },
  profileInitial: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  profileTextContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 16,
  },
  lineSegment: {
    width: 2,
    height: 40, // Adjust the height as needed
  },
  swipeButton: {
    marginHorizontal: 20,
    marginBottom: 10,
  },
  locationPinImage: {
    width: 20,
    height: 20,
    marginRight: 10,
  },
  horizantalLine: {
    height: 2,
    backgroundColor: '#F5F5F5',
    marginBottom: 12,
  },
  innerContainer: {
    paddingLeft: 16,
  },
  paymentInnerContainer: {
    padding: 10,
    backgroundColor: '#f5f5f5',
    marginTop: 10,
    marginBottom: 10,
  },
  PaymentItemContainer: {
    paddingLeft: 16,
    flexDirection: 'column',
    gap: 5,
  },
  sectionContainer: {
    marginBottom: 16,
    paddingLeft: 16,
    paddingRight: 16,
    width: '95%',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#212121',
    marginBottom: 8,
    paddingBottom: 15,
  },
  sectionBookedTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 8,
  },
  editText: {
    color: '#ff5700',
    fontSize: 15,
    fontWeight: '500',
  },
  serviceTimeLineContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionPaymentTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 8,
    paddingLeft: 10,
  },
  innerContainerLine: {
    paddingLeft: 16,
  },
  serviceDetail: {
    fontSize: 14,
    color: '#212121',
    fontWeight: '500',
    marginBottom: 4,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineTextContainer: {
    flex: 1,
    marginLeft: 10,
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
  backIcon: {
    marginRight: 10,
  },
  headerText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  profileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 15,
    paddingLeft: 16,
  },
  // profileImage: {
  //   width: 70,
  //   height: 70,
  //   backgroundColor:'#ccc',
  //   borderRadius: 35,
  //   marginRight: 16,
  // },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1D2951',
  },
  userDesignation: {
    fontSize: 14,
    color: '#4a4a4a',
  },

  pinContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingBottom: 10,
    paddingLeft: 16,
  },
  pinText: {
    color: '#1D2951',
    fontSize: 16,
    paddingTop: 10,
  },
  pinBoxesContainer: {
    flexDirection: 'row',
    gap: 5,
  },
  pinBox: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#212121',
    borderRadius: 5,
  },
  pinNumber: {
    color: '#212121',
    fontSize: 14,
  },
  innerContainerLine: {
    position: 'relative', // To contain the absolute positioned vertical line
    paddingLeft: 30, // Adjust to provide space for the line and icons
  },
  serviceDetail: {
    fontSize: 14,
    color: '#212121',
    marginBottom: 4,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
  },
  addressTextContainer: {
    marginLeft: 10,
  },
  addressTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  address: {
    fontSize: 13,
    color: '#212121',
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  paymentLabel: {
    fontSize: 14,
    color: '#212121',
  },
  paymentValue: {
    fontSize: 14,
    color: '#212121',
    fontWeight: 'bold',
  },
  paymentOptionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingLeft: 16,
  },
  paymentOptionText: {
    fontSize: 14,
    color: '#000',
    marginLeft: 8,
  },
  payButton: {
    backgroundColor: '#ff4500',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 20,
    marginHorizontal: 20,
  },
  payButtonText: {
    fontSize: 16,
    textAlign: 'center',
    fontWeight: 'bold',
    color: '#fff',
  },
});

export default ServiceBookingItem;
