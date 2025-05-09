const express = require("express");
const app = express();
const {
  homeServices,
  sendOtp,
  validateOtp,
  verifyOTP,
  getUserById,
  getElectricianServices,
  getServices,
  getPlumberServices,
  getCleaningServices,
  getPaintingServices,
  getVehicleServices,
  login,
  storeUserLocation,
  addWorker,
  storeWorkerLocation,
  storeFcmToken,
  getWorkersNearby,
  Partnerlogin,
  workerAuthentication,
  acceptRequest,
  rejectRequest,
  checkStatus,
  getServicesBySearch,
  getLocationDetails,
  userCancelNavigation,
  cancelRequest,
  checkCancellationStatus,
  updateUserNavigationStatus,
  fetchLocationDetails,
  workerCancelNavigation,
  workerCancellationStatus,
  userCancellationStatus,
  getUserAddressDetails,
  updateWorkerLocation,
  workerVerifyOtp,
  startStopwatch,
  stopStopwatch,
  getTimerValue,
  paymentDetails,
  calculatePayment,
  getWorkDetails,
  subservices,
  serviceCompleted,
  skillWorkerRegistration,
  workerLifeDetails,
  registrationStatus,
  updateWorkerLifeDetails,
  getWorkerNavigationDetails,
  workerProfileDetails,
  getVerificationStatus,
  workerDetails,
  submitFeedback,
  processPayment,
  getUserBookings,
  loginStatus,
  createUserAction,
  getUserTrackRoute,
  getWorkerTrackRoute,
  createWorkerAction,
  storeNotification,
  getWorkerNotifications,
  storeUserFcmToken,
  storeUserNotification,
  getUserNotifications,
  getIndividualServices,
  userUpdateLastLogin,
  workCompletedRequest,
  TimeStart,
  CheckStartTime,
  workCompletionCancel,
  checkTaskStatus,
  getTimeDifferenceInIST,
  getAllLocations,
  userActionRemove,
  getWorkerBookings,
  sendSMSVerification,
  getServiceByName,
  getWorkerProfleDetails,
  getWorkerReviewDetails,
  getPaymentDetails,
  getServiceCompletedDetails,
  getWorkerEarnings,
  getUserAndWorkerLocation,
  userNavigationCancel,
  workerCompleteSignUp,
  checkOnboardingStatus,
  getServicesPhoneNumber,
  registrationSubmit,
  addBankAccount,
  addUpiId,
  onboardingSteps,
  getWorkerProfileDetails,
  balanceAmmountToPay,
  getWorkerDetails,
  insertRelatedService,
  getUserAllBookings,
  userProfileDetails,
  accountDetailsUpdate,
  insertTracking,
  getWorkerTrackingServices,
  getServiceTrackingWorkerItemDetails,
  serviceTrackingUpdateStatus,
  getServiceTrackingUserItemDetails,
  getUserTrackingServices,
  serviceDeliveryVerification,
  getPendingWorkers,
  getPendingWorkerDetails,
  updateIssues,
  updateApproveStatus,
  checkApprovalVerificationStatus,
  workerApprove,
  getServiceBookingItemDetails,
  getWorkersPendingCashback,
  getWorkerCashbackDetails,
  workerCashbackPayed,
  userCompleteSignUp,
  workerNavigationCancel,
  getAllTrackingServices,
  pendingBalanceWorkers,
  getDashboardDetails,
  userWorkerInProgressDetails,
  WorkerWorkInProgressDetails,
  workerWorkingStatusUpdated,
  getServicesRegisterPhoneNumber,
  registerUser,
  userCoupons,
  userReferrals,
  getWorkerBalanceDetails,
  workerMessage,
  workerSearch,
  cashbackHistory,
  getWorkerServiceHistory,
  currentService,
  balanceHistory ,
  workerScreenChange,
  getPendingWorkersNotStarted,
  administratorDetails,
  workerTokenVerification,
  adminLogin,
  WorkerValidateOtp,
  partnerValidateOtp,
  WorkerSendOtp,
  createOrder,
  verifyPayment,
  createFundAccount,
  validateAndSaveUPI ,
  userLogout,
  workerLogout,
  phoneCall,
  UserPhoneCall,
  accountDelete,
  userTrackingCall,
  workerTrackingCall,
  getUserOngoingBookings,
  getServiceOngoingItemDetails,
  userProfileUpdate,
  getWorkerOngoingBookings,
  getServiceOngoingWorkerItemDetails,
  sendMessageWorker,
  workerGetMessage,
  sendMessageUser,
  callMasking,
  workerProfileScreenDetails,
  workerProfileUpdate,
  profileChangesSubmit,
  fetchOffers,
  offerValidation,
  translateText,
  getRoute,
  initiateCall,
  getServiceBookingUserItemDetails,
  getSpecialOffers,
  partnerSendOtp
} = require("./controller.js");

const router = express.Router();
const { authenticateToken } = require("./src/middlewares/authMiddleware.js");
const {
  authenticateWorkerToken,
} = require("./src/middlewares/authworkerMiddleware.js");
const { authAdminMiddleware } = require("./src/middlewares/authAdminMiddleware.js");

// Define the route for getting service details
router.post("/single/service", getServiceByName);

router.get("/home/services",homeServices)

router.post("/route",getRoute)

router.post('/worker/call', phoneCall);
router.post('/user/call', UserPhoneCall);

router.post('/worker/tracking/call',workerTrackingCall)
router.post('/user/tracking/call',userTrackingCall);

router.post('/workerLogout', workerLogout);

router.post("/individual/worker/pending/verification", getPendingWorkerDetails);

router.post("/create-order",authenticateWorkerToken, createOrder);

// Route to verify payment
router.post("/verify-payment",authenticateWorkerToken, verifyPayment);


router.get("/workers/pending/verification", getPendingWorkers);

router.get("/workers/pending/notStarted", getPendingWorkersNotStarted);

router.post("/administrator/service/date/details",administratorDetails)


router.post(
  "/service/tracking/delivery/verification",
  serviceDeliveryVerification
);

router.post("/relatedservices", insertRelatedService);

router.post("/update/worker/issues", updateIssues);

router.post("/aprove/tracking/update/status", updateApproveStatus);

router.post(
  "/check/approval/verification/status",
  authenticateWorkerToken,
  checkApprovalVerificationStatus
);

router.post("/worker/approved", workerApprove);

router.post("/service/location/navigation", getUserAndWorkerLocation);

// Route to fetch location details and initiate /canceled/timeup
router.get("/user/location/navigation", async (req, res) => {
  try {
    const { notification_id } = req.query;

    if (!notification_id) {
      return res.status(400).json({ error: "Missing notification_id" });
    }

    const locationDetails = await fetchLocationDetails(notification_id);
    // console.log(`location start and end ${JSON.stringify(locationDetails, null, 2)}`);
    res.json(locationDetails);

    // Start the interval to update user_navigation_cancel_status to 'timeup' after 2 minutes
    if (notification_id && !intervalSetForNotifications.has(notification_id)) {
      console.log("userlocationpath");
      intervalSetForNotifications.add(notification_id);
      setTimeout(
        () => updateUserNavigationStatus(notification_id),
        2 * 60 * 1000
      ); // 2 minutes
    }
  } catch (err) {
    console.error("Error fetching location details:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/service/tracking/update/status", serviceTrackingUpdateStatus);

router.post("/register", registerUser);

router.post(
  "/service/tracking/worker/item/details",
  getServiceTrackingWorkerItemDetails
);

router.post(
  "/service/tracking/user/item/details",
  getServiceTrackingUserItemDetails
);

router.post("/service/booking/item/details", getServiceBookingItemDetails);

router.post("/service/booking/user/item/details", getServiceBookingUserItemDetails);



router.post("/service/ongoing/booking/item/details", getServiceOngoingItemDetails);

router.get("/worker/getMessages",workerGetMessage);



router.post("/service/ongoing/worker/booking/item/details", getServiceOngoingWorkerItemDetails);

router.post("/send/message/worker",sendMessageWorker);

router.post("/send/message/user",sendMessageUser);

router.post("/user/coupons", authenticateToken, userCoupons);

router.post("/user/updateProfileImage",authenticateToken,userProfileUpdate)

router.post("/worker/updateProfileImage",authenticateWorkerToken,workerProfileUpdate)

// Define the route for processing payment
router.post("/user/payed", processPayment);

router.post("/add/tracking", insertTracking);

router.post("/user/details/update", authenticateToken, accountDetailsUpdate);

router.post("/user/details/delete",authenticateToken,accountDelete)

router.post("/user/profile", authenticateToken, userProfileDetails);


router.post("/worker/profile", authenticateWorkerToken, workerProfileScreenDetails);


// Route to add a new user
router.post("/add/worker", async (req, res) => {
  try {
    const newWorker = await addWorker(req.body);
    res.status(201).json(newWorker);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// router.post('/login', async (req,res) => {
//     try {
//         const user = await login(req.body);
//         if (user) {
//          res.json(user);
//         } else {
//             res.status(404).json({ error: 'user not found' });
//         }
//         } catch (err) {
//             res.status(500).json({ error: 'Server error' });
//             }
// })

router.post("/subservice/checkboxes", subservices);

router.post("/balance/ammount", authenticateWorkerToken, balanceAmmountToPay);

router.post("/worker/cashback/payed", workerCashbackPayed);

router.get("/worker/verification/status", getVerificationStatus);

router.post("/login", login);

router.post("/pin/verification", authenticateToken, workerVerifyOtp);

router.post("/worker/login", Partnerlogin);

router.post("/user/login", login);

router.post("/worker/signup", workerCompleteSignUp);

router.post("/user/signup", userCompleteSignUp);

router.get("/step-status", authenticateWorkerToken, checkOnboardingStatus);

router.get(
  "/profile/detsils",
  authenticateWorkerToken,
  getWorkerProfileDetails
);

router.post("/timer/value", getTimerValue);

// router.post('/payment/details', async (req, res) => {
//   const {notification_id} = req.body

//   const { start_time, end_time, time_worked } = await paymentDetails(notification_id);

//   const totalAmount = calculatePayment(time_worked);
//   res.json({
//       start_time,
//       end_time,
//       time_worked,
//       totalAmount
//   });
// });

router.post("/worker/payment/scanner/details", async (req, res) => {
  const { notification_id } = req.body;
  // console.log(notification_id);
  // const { start_time, end_time } = await paymentDetails(notification_id);
  // console.log(start_time);
  // const { time_worked } = getTimeDifferenceInIST(start_time, end_time);
  // const totalAmount = calculatePayment(time_worked);
  const { name, service, discount, total_cost } = await getPaymentDetails(
    notification_id
  );
  // const {
  //   service_booked,
  //   gstAmount,
  //   cgstAmount,
  //   discountAmount,
  //   fetchedFinalTotalAmount,
  // } = await getWorkerDetails(notification_id);
  res.json({ 
    totalAmount: total_cost,
    name, 
    service,
    discount,
  });
});

router.post(
  "/worker/payment/service/completed/details",
  getServiceCompletedDetails
);

router.post("/worker/earnings", authenticateWorkerToken, getWorkerEarnings);

// router.post("/payment/details", async (req, res) => {
//   const { notification_id } = req.body;
//   // const { start_time, end_time } = await paymentDetails(notification_id);
//   // console.log(start_time);
//   // const { time_worked } = getTimeDifferenceInIST(start_time, end_time);
//   // const totalAmount = calculatePayment(time_worked);

//   const workerDetails = await getWorkerDetails(notification_id);
//   console.log(workerDetails);

//   if (workerDetails.error) {
//     return res.status(404).json({ message: workerDetails.error });
//   }

//   const {
//     name,
//     area,
//     city,
//     pincode,
//     service_booked,
//     discount,
//     // gstAmount,
//     // cgstAmount,
//     // discountAmount,
//     // fetchedFinalTotalAmount,
//     profile,
//     total_cost
//   } = workerDetails; 

//   res.json({
//     // start_time,
//     // end_time,
//     // time_worked,
//     // totalAmount,
//     // total_cost,
//     // service_booked,
//     // name,
//     // area,
//     // city,
//     // pincode,
//     // gstAmount,
//     // cgstAmount,
//     // discountAmount,
//     // fetchedFinalTotalAmount,
//     // profile,

//     name,
//     area,
//     city,
//     pincode,
//     service_booked,
//     discount,
//     // gstAmount,
//     // cgstAmount,
//     // discountAmount,
//     // fetchedFinalTotalAmount,
//     profile,
//     total_cost

//   });
// });

router.post("/payment/details",  getWorkerDetails);

router.post('/userLogout', userLogout);

router.post("/worker/details/rating", async (req, res) => {
  const { notification_id } = req.body;

  await workerDetails(req, res, notification_id);
});

router.post("/user/feedback", authenticateToken, submitFeedback);

router.post("/work/time/started", CheckStartTime);

//router.post("/worker/details/rating",workerDetails)

router.post("/worker/navigation/details", getWorkerNavigationDetails);

router.post("/individual/service", getIndividualServices);

router.post("/work/time/completed", async (req, res) => {
  const { notification_id } = req.body;
  try {
    // Stop stopwatch and get worker_id
    const workerId = await stopStopwatch(notification_id);

    // Get time_worked and calculate totalAmount
    const { time_worked } = await paymentDetails(notification_id);
    const totalAmount = calculatePayment(time_worked);

    // Update worker life details
    const updatedWorkerLife = await updateWorkerLifeDetails(
      workerId,
      totalAmount
    );

    res.status(200).json({
      message: "Worker life details updated successfully",
      updatedWorkerLife,
    });
  } catch (error) {
    console.error("Error processing work time completion:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/work/time/start", async (req, res) => {
  const { notification_id } = req.body;
  console.log(notification_id);
  if (!notification_id) {
    return res.status(400).json({ error: "notification_id is required" });
  }

  try {
    const result = await startStopwatch(notification_id);
    console.log(result);
    res.status(200).json({ worked_time: result });
  } catch (error) {
    console.error("Error starting stopwatch:", error);
    res.status(500).json({ error: "Failed to start stopwatch" });
  }
});

// Route to get electrician services
router.get("/electrician/services", async (req, res) => {
  try {
    const services = await getElectricianServices();
    if (services) {
      res.json(services);
    } else {
      res.status(404).json({ error: "Electrician services not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Route to get plumber services
router.get("/plumber/services", async (req, res) => {
  try {
    const services = await getPlumberServices();
    if (services) {
      res.json(services);
    } else {
      res.status(404).json({ error: "plumber services not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Route to get plumber services
router.get("/cleaning/services", async (req, res) => {
  try {
    const services = await getCleaningServices();
    if (services) {
      res.json(services);
    } else {
      res.status(404).json({ error: "cleaning services not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Route to get plumber services
router.get("/painting/services", async (req, res) => {
  try {
    const services = await getPaintingServices();
    if (services) {
      res.json(services);
    } else {
      res.status(404).json({ error: "painting services not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Route to get plumber services
router.get("/vehicle/services", async (req, res) => {
  try {
    const services = await getVehicleServices();
    if (services) {
      res.json(services);
    } else {
      res.status(404).json({ error: "vehicle services not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Route to get all services
router.get("/servicecategories", async (req, res) => {
  try {
    const users = await getServices();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// router.get(
//   "/service/categories",
//   authenticateWorkerToken,
//   getServicesPhoneNumber
// );

router.get(
  "/service/categories",
  authenticateWorkerToken,
  getServicesPhoneNumber
);

router.get(
  "/service/categories/registration",
  authenticateWorkerToken,
  getServicesRegisterPhoneNumber
);

router.post("/validate-token", authenticateToken, (req, res) => {
  res.json({ isValid: true });
});

router.post(
  "/registration/submit",
  authenticateWorkerToken,
  registrationSubmit
);

router.post(
  "/profile/changes/submit",
  authenticateWorkerToken,
  profileChangesSubmit
);


router.post("/account/submit", authenticateWorkerToken, addBankAccount);

router.post("/account/fund_account",authenticateWorkerToken,createFundAccount)

router.post("/upi/submit", authenticateWorkerToken, validateAndSaveUPI );

router.post(
  "/onboarding/step-status", 
  authenticateWorkerToken,
  onboardingSteps
);

// Route to send OTP
// router.post("/phonenumber", sendOtp);

// POST request to send OTP
router.post("/otp/send", sendOtp);

router.post("/partner/otp/send", partnerSendOtp);


router.post("/partner/sendOtp", partnerSendOtp);

router.post("/worker/sendOtp",WorkerSendOtp)

router.get("/worker/validateOtp",WorkerValidateOtp)

// GET request to validate OTP
router.get("/validate", validateOtp);

router.get("/partner/validateOtp", partnerValidateOtp);

// Route to verify OTP
router.post("/otp-verify", verifyOTP);

router.get("/location/navigation", getLocationDetails);

// Route to fetch location details and initiate navigation
// Set to store ongoing intervals
const intervalSetForNotifications = new Set();

router.get("/locations", getAllLocations);

router.get("/user/login/status", authenticateToken, loginStatus);

router.get(
  "/worker/tracking/services",
  authenticateWorkerToken,
  getWorkerTrackingServices
);

router.post("/callMasking",callMasking)

router.get("/all/tracking/services", getAllTrackingServices);

router.post("/user/work/progress/details", userWorkerInProgressDetails);

router.post("/worker/working/status/updated", workerWorkingStatusUpdated);

router.post("/worker/work/progress/details", WorkerWorkInProgressDetails);

router.get("/worker/balance/history",balanceHistory);

router.post("/administrator/service/date/details", getDashboardDetails);

router.get("/workers/pending/cashback", getWorkersPendingCashback);

router.post("/worker/screen/change",workerScreenChange)

router.post("/worker/pending/cashback", getWorkerCashbackDetails);

router.post("/worker/pending/balance", getWorkerBalanceDetails); 

router.post("/worker/token/verification",authenticateWorkerToken,workerTokenVerification)

router.get("/worker/service/history", getWorkerServiceHistory);

router.get("/worker/current/service", currentService);

router.get("/admin/login",adminLogin)

router.post("/worker/message", workerMessage);


router.get("/pending/balance/workers", pendingBalanceWorkers);

router.get(
  "/user/tracking/services", 
  authenticateToken,
  getUserTrackingServices
);

router.get("/get/user", authenticateToken, getUserById);

// router.get('/user/bookings',authenticateToken, getUserBookings);

// Route to send SMS verification
router.post("/send-sms", sendSMSVerification);

router.get("/worker/bookings", authenticateWorkerToken, getWorkerBookings);

router.get("/user/bookings", authenticateToken, getUserAllBookings);

router.get("/user/ongoingBookings",authenticateToken, getUserOngoingBookings);

router.get("/worker/ongoingBookings",authenticateWorkerToken, getWorkerOngoingBookings);



router.get(
  "/worker/profile/details",
  authenticateWorkerToken,
  getWorkerProfleDetails
);

router.get("/worker/ratings", authenticateWorkerToken, getWorkerReviewDetails);

router.post("/work/time/completed/request", workCompletedRequest);

router.post("/user/location", authenticateToken, storeUserLocation);

router.post("/worker/location", storeWorkerLocation);

router.post("/worker/store-fcm-token", authenticateWorkerToken, storeFcmToken);

router.post("/user/store-fcm-token", authenticateToken, storeUserFcmToken);

router.post("/initiateCall",initiateCall);

router.post(
  "/worker/store-notification",
  authenticateWorkerToken,
  storeNotification
);

router.post(
  "/user/store-notification",
  authenticateToken,
  storeUserNotification
);

router.get("/user/track/details", authenticateToken, getUserTrackRoute);

router.get("/user/offers",authenticateToken,fetchOffers)

router.get(
  "/worker/track/details",
  authenticateWorkerToken,
  getWorkerTrackRoute
);

router.get(
  "/worker/notifications",
  authenticateWorkerToken,
  getWorkerNotifications
);

router.post('/translate', translateText);


router.get("/user/notifications", authenticateToken, getUserNotifications);

router.post("/user/action", authenticateToken, createUserAction);

router.post("/user/action/cancel", authenticateToken, userActionRemove);

router.post("/worker/action", authenticateWorkerToken, createWorkerAction);

router.post(
  "/worker/skill/registration/filled",
  authenticateWorkerToken,
  skillWorkerRegistration
);

router.get("/worker/life/details", authenticateWorkerToken, workerLifeDetails);

router.post("/profile", authenticateWorkerToken, workerProfileDetails);

// Define the route for fetching user bookings
router.get("/", (req, res) => {
  res.status(200).json("working");
});

router.post("/user/cancellation", cancelRequest);

// Define the route for cancelling the navigation
router.post("/user/tryping/cancel", userCancelNavigation);

// Define the route for cancelling the navigation
router.post("/user/work/cancel", userNavigationCancel);

router.post("/worker/work/cancel", workerNavigationCancel);

router.post("/user/validate-offer",authenticateToken,offerValidation)

router.post(
  "/registration/status",
  authenticateWorkerToken,
  registrationStatus
);

router.post("/worker/tryping/cancel", workerCancelNavigation);

router.get("/user/cancelled/status", workerCancellationStatus);

router.get("/worker/cancelled/status", userCancellationStatus);

// Route definitions
router.get("/api/location/navigation", getLocationDetails);

router.post(
  "/worker/location/update",
  authenticateWorkerToken,
  updateWorkerLocation
);

router.get("/cancelation/navigation/status", checkCancellationStatus);

router.post("/cancelation/navigation/status", async (req, res) => {
  const { notification_id } = req.body;
  try {
    await pool.query(
      "UPDATE notifications SET navigation_status = 'cancel' WHERE notification_id = $1",
      [notification_id]
    );
    res.json({ message: "Navigation status updated to cancel" });
  } catch (error) {
    console.error("Error updating cancellation status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post(
  "/worker/authenticate",
  authenticateWorkerToken,
  workerAuthentication
);

router.post(
  "/user/active/update",
  authenticateWorkerToken,
  userUpdateLastLogin
);

router.post("/accept/request", authenticateWorkerToken, acceptRequest);

router.get("/user/referrals", authenticateToken, userReferrals);

router.post("/work/completion/cancel", workCompletionCancel);

router.post("/worker/details", getWorkDetails);

router.post("/worker/confirm/completed", serviceCompleted);

router.post("/reject/request", authenticateWorkerToken, rejectRequest);

router.get("/checking/status", checkStatus);

router.get("/special/offers",getSpecialOffers)

router.post("/task/confirm/status", checkTaskStatus);

router.get("/user/address/details", getUserAddressDetails);

// router.get('/workers-nearby/:user_id', getWorkersNearby);

router.post("/workers-nearby", authenticateToken, getWorkersNearby);

router.get("/services", getServicesBySearch);

router.get("/worker/search", workerSearch);

router.get("/worker/cashback/history",cashbackHistory)

module.exports = router;
