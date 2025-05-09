const admin = require("./firebaseAdmin.js");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { encrypt, decrypt } = require("./src/utils/encrytion.js");
const { getMessaging } = require("firebase-admin/messaging"); // Import Firebase Admin SDK
const db = admin.firestore();
const client = require("./connection.js");
const axios = require("axios");
var cron = require("node-cron");
const {
  generateToken,
  generateWorkerToken,
  generateAdminToken
} = require("./src/utils/generateToken.js");
const { response } = require("express");
const request = require("request");
const { off, constrainedMemory } = require("process");
const { v4: uuidv4 } = require('uuid');

// Telesign API credentials
const customerId = "1D0C4D6D-48D8-40A2-BD9D-CE2160F6B3E9";
const apiKey =
  "BQXK2DGbESmYMvO0JC2sNAd9AtOTh48AwaPZIWL7bd8o8mB63TjwAJ/BhNxO3/YD6pjjZFQR5j6Ke1wEA1TCew==";
const smsEndpoint = `https://rest-api.telesign.com/v1/messaging`;


const subscriptionKey = '1rFYPImsvNSHdC4MqvEUBYCUdJNaiCOAObvtk2N6fGhJ3BtIItNxJQQJ99BCACGhslBXJ3w3AAAbACOGxFd0';
const region = 'centralindia';
const endpoint = 'https://api.cognitive.microsofttranslator.com';
const apiVersion =  '3.0';


// Initialize Razorpay
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});

// Create Order API
const createOrder = async (req, res) => {
  try {
    const { amount, currency = 'INR' } = req.body;
    const worker_id = req.worker.id; // from authenticateWorkerToken
    console.log("wo",worker_id)
    // Convert amount from rupees to paise for Razorpay
    const rupeesAmount = parseFloat(amount).toFixed(2);
    const paiseAmount = Math.round(parseFloat(amount) * 100);

    // Set options for Razorpay order creation
    const options = {
      amount: paiseAmount,       // Amount in paise
      currency,
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1,        // Auto-capture payment
    };

    // Create the order with Razorpay
    const order = await razorpayInstance.orders.create(options);
    console.log('Razorpay Order:', order); // Debug log

    if (!order || !order.id) {
      throw new Error('Order creation failed: No valid order returned from Razorpay.');
    }

    // Insert the pending order into the orders table
    const insertOrderQuery = `
      INSERT INTO orders (worker_id, order_id, amount, currency, status, created_at)
      VALUES ($1, $2, $3, $4, 'pending', NOW())
    `;
    await client.query(insertOrderQuery, [worker_id, order.id, rupeesAmount, currency]);

    res.status(200).json({
      success: true,
      order_id: order.id,
      amount: rupeesAmount,
      currency,
    });
  } catch (error) {
    console.error('Error in createOrder:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getRoute = async (req, res) => {
  try {
    // Expect payload:
    // { startPoint: [lng, lat], endPoint: [lng, lat] }
    const { startPoint, endPoint } = req.body;
    console.log('Request body:', req.body);

    if (
      !startPoint ||
      !endPoint ||
      !Array.isArray(startPoint) ||
      !Array.isArray(endPoint) ||
      startPoint.length !== 2 ||
      endPoint.length !== 2
    ) {
      return res.status(400).json({
        error:
          'Missing or invalid parameters: startPoint and endPoint are required as arrays [lng, lat].',
      });
    }

    // Destructure values from the arrays.
    const [startLng, startLat] = startPoint;
    const [endLng, endLat] = endPoint;

    // Ola Maps API key
    const apiKey = process.env.OLA_API_KEY || 'q0k6sOfYNxdt3bGvqF6W1yvANHeVtrsu9T5KW9a4';
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured on server' });
    }

    // Format URL for Ola Maps Directions API.
    // Note that the API expects origin/destination as lat,lng pairs.
    const url = `https://api.olamaps.io/routing/v1/directions?origin=${startLat},${startLng}&destination=${endLat},${endLng}&api_key=${apiKey}`;

    // Use POST method and include required headers:
    const response = await axios.post(url, null, {
      headers: {
        'X-Request-Id': `req-${Date.now()}`,
        'Origin': 'https://clicksolver.com' // Replace with your actual domain
      },
    });

    res.status(200).json(response.data);
  } catch (error) {
    console.error(
      'Error fetching route:',
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: error.toString() });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const worker_id = req.worker.id; // from authenticateWorkerToken
    console.log("worker_id", worker_id);

    // Generate expected signature using HMAC with SHA256
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const paymentStatus = expectedSignature === razorpay_signature ? 'success' : 'failed';
    console.log("status", paymentStatus);
    const payment_method = req.body.method || 'unknown';
    const error_message = paymentStatus === 'failed' ? 'Invalid payment signature' : null;

    // Begin transaction
    await client.query('BEGIN');

    // 1) Update orders and insert payment (using chained CTEs)
    const cteQuery = `
      WITH updated_order AS (
        UPDATE orders
        SET status = $3::text,
            updated_at = NOW()
        WHERE order_id = $1::text
          AND worker_id = $2::int
        RETURNING amount
      ),
      insert_payment AS (
        INSERT INTO payments (
          worker_id,
          order_id,
          payment_id,
          amount_paid,
          status,
          payment_method,
          transaction_date,
          error_message
        )
        VALUES (
          $2::int,
          $1::text,
          $4,
          (SELECT amount FROM updated_order),
          $3::text,
          $5::text,
          NOW(),
          $6::text
        )
        RETURNING order_id, payment_id, amount_paid, status
      )
      SELECT order_id, payment_id, amount_paid, status FROM insert_payment;
    `;
    const paymentResult = await client.query(cteQuery, [
      razorpay_order_id,
      worker_id,
      paymentStatus,
      razorpay_payment_id,
      payment_method,
      error_message,
    ]);

    // 2) Update workerlife and workersverified with minimal data returned
    const updateCombinedQuery = `
      WITH order_amt AS (
        SELECT amount::numeric AS amt
        FROM orders
        WHERE order_id = $1::text
      ),
      current_balance AS (
        SELECT COALESCE(balance_amount, 0) AS curr_balance
        FROM workerlife
        WHERE worker_id = $2::int
      ),
      new_balance AS (
        SELECT curr_balance + order_amt.amt AS computed_balance
        FROM current_balance, order_amt
      ),
      update_workerlife AS (
        UPDATE workerlife
        SET balance_amount = new_balance.computed_balance,
            balance_payment_history = COALESCE(balance_payment_history, '[]'::jsonb) ||
              jsonb_build_array(
                jsonb_build_object(
                  'order_id', $1::text,
                  'amount', (SELECT amt FROM order_amt),
                  'time', TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
                  'status', $3::text,
                  'paid', 'Paid to Click Solver'
                )
              )
        FROM new_balance
        WHERE workerlife.worker_id = $2::int
      ),
      update_workersverified AS (
        UPDATE workersverified
        SET no_due = CASE WHEN $3::text = 'success' THEN true ELSE no_due END
        WHERE worker_id = $2::int
      )
      SELECT 1;
    `;
    await client.query(updateCombinedQuery, [
      razorpay_order_id,
      worker_id,
      paymentStatus,
    ]);

    // Commit the transaction
    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Payment verified successfully!',
      data: paymentResult.rows,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in verifyPayment:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const workerTrackingCall = async (req, res) => {
  try {
    const { tracking_id } = req.body;

    if (!tracking_id) {
      return res.status(400).json({ message: "Valid decodedId is required." });
    }

    // Fetch `from_number` from accepted table by joining with user and workersverified tables
    const query = `
      SELECT 
        u.phone_number AS from_number, 
        w.phone_number AS mobile_number
      FROM servicetracking s
      JOIN "user" u ON s.user_id = u.user_id
      JOIN workersverified w ON s.worker_id = w.worker_id
      WHERE s.tracking_id = $1
    `;

    const values = [tracking_id];
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No matching data found." });
    }

    const { from_number, mobile_number } = result.rows[0];

    // Ensure these are strings (avoiding JSON structure issues)
    if (typeof from_number !== "string" || typeof mobile_number !== "string") {
      return res.status(500).json({ message: "Invalid phone number format." });
    }

    console.log("From Number:", from_number, "Mobile Number:", mobile_number);

    // Call the external API
    const apiResponse = await axios.post(
      'https://apiv1.cloudshope.com/api/outboundCall',
      { from_number, mobile_number },
      {
        headers: {
          Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzgzLCJ1c2VybmFtZSI6Illhc2h3YW50NjU0OTQiLCJtYWluX3VzZXIiOjEwMzgzLCJpYXQiOjE3Mzk3NzIzOTB9.HKURS7DdnYsizBBDgeTn6E5JpkKk1C8qkuRDL3l3qDE`
        }
      }
    );

    // Extract mobile from response, fallback to worker's number if missing
    const responseData = apiResponse.data?.data?.mobile || mobile_number;

    console.log("Final Number (Masked or Worker’s):", responseData);

    res.status(200).json({
      message: "Call initiated successfully.",
      mobile: responseData
    });

  } catch (error) {
    console.error("Error initiating call:", error.message);

    res.status(500).json({
      message: "Internal server error.",
      error: error.message
    });
  }
};

const phoneCall = async (req, res) => {
  try {
    const { decodedId } = req.body;

    if (!decodedId || typeof decodedId !== "string") {
      return res.status(400).json({ message: "Valid decodedId is required." });
    }

    // Fetch `from_number` from accepted table by joining with user and workersverified tables
    const query = `
      SELECT 
        u.phone_number AS from_number, 
        w.phone_number AS mobile_number
      FROM accepted a
      JOIN "user" u ON a.user_id = u.user_id
      JOIN workersverified w ON a.worker_id = w.worker_id
      WHERE a.notification_id = $1
    `;

    const values = [decodedId];
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No matching data found." });
    }

    const { from_number, mobile_number } = result.rows[0];

    // Ensure these are strings (avoiding JSON structure issues)
    if (typeof from_number !== "string" || typeof mobile_number !== "string") {
      return res.status(500).json({ message: "Invalid phone number format." });
    }

    console.log("From Number:", from_number, "Mobile Number:", mobile_number);

    // Call the external API
    const apiResponse = await axios.post(
      'https://apiv1.cloudshope.com/api/outboundCall',
      { from_number, mobile_number },
      {
        headers: {
          Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzgzLCJ1c2VybmFtZSI6Illhc2h3YW50NjU0OTQiLCJtYWluX3VzZXIiOjEwMzgzLCJpYXQiOjE3Mzk3NzIzOTB9.HKURS7DdnYsizBBDgeTn6E5JpkKk1C8qkuRDL3l3qDE`
        }
      }
    );

    // Extract mobile from response, fallback to worker's number if missing
    const responseData = apiResponse.data?.data?.mobile || mobile_number;

    console.log("Final Number (Masked or Worker’s):", responseData);

    res.status(200).json({
      message: "Call initiated successfully.",
      mobile: responseData
    });

  } catch (error) {
    console.error("Error initiating call:", error.message);

    res.status(500).json({
      message: "Internal server error.",
      error: error.message
    });
  }
};

const userTrackingCall = async (req, res) => {
  try {
    const { tracking_id } = req.body;

    if (!tracking_id) {
      return res.status(400).json({ message: "Valid tracking_id is required." });
    }

    // Fetch `from_number` from servicetracking table by joining with user and workersverified tables
    const query = `
      SELECT 
        u.phone_number AS mobile_number,  -- User's phone number
        w.phone_number AS from_number    -- Worker's phone number
      FROM servicetracking s
      JOIN "user" u ON s.user_id = u.user_id
      JOIN workersverified w ON s.worker_id = w.worker_id
      WHERE s.tracking_id = $1
    `;

    const values = [tracking_id];
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No matching data found." });
    }

    const { from_number, mobile_number } = result.rows[0];

    // Ensure these are valid strings
    if (typeof from_number !== "string" || typeof mobile_number !== "string") {
      return res.status(500).json({ message: "Invalid phone number format." });
    }

    console.log("From Number:", from_number, "User's Mobile Number:", mobile_number);

    // Call the external API
    const apiResponse = await axios.post(
      'https://apiv1.cloudshope.com/api/outboundCall',
      { from_number, mobile_number },
      {
        headers: {
          Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzgzLCJ1c2VybmFtZSI6Illhc2h3YW50NjU0OTQiLCJtYWluX3VzZXIiOjEwMzgzLCJpYXQiOjE3Mzk3NzIzOTB9.HKURS7DdnYsizBBDgeTn6E5JpkKk1C8qkuRDL3l3qDE`
        }
      }
    );

    // Extract mobile from response, fallback to user's number if missing
    const responseData = apiResponse.data?.data?.mobile || mobile_number;

    console.log("Final Number (Masked or User’s):", responseData);

    res.status(200).json({
      message: "Call initiated successfully.",
      mobile: responseData
    });

  } catch (error) {
    console.error("Error initiating call:", error.message);

    res.status(500).json({
      message: "Internal server error.",
      error: error.message
    });
  }
};


const UserPhoneCall = async (req, res) => {
  try {
    const { decodedId } = req.body;

    if (!decodedId || typeof decodedId !== "string") {
      return res.status(400).json({ message: "Valid decodedId is required." });
    }

    // Fetch `from_number` from accepted table by joining with user and workersverified tables
    const query = `
      SELECT 
        u.phone_number AS mobile_number,  -- User's phone number
        w.phone_number AS from_number    -- Worker's phone number
      FROM accepted a
      JOIN "user" u ON a.user_id = u.user_id
      JOIN workersverified w ON a.worker_id = w.worker_id
      WHERE a.notification_id = $1
    `;

    const values = [decodedId];
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No matching data found." });
    }

    const { from_number, mobile_number } = result.rows[0];

    // Ensure these are valid strings
    if (typeof from_number !== "string" || typeof mobile_number !== "string") {
      return res.status(500).json({ message: "Invalid phone number format." });
    }

    console.log("From Number:", from_number, "User's Mobile Number:", mobile_number);

    // Call the external API
    const apiResponse = await axios.post(
      'https://apiv1.cloudshope.com/api/outboundCall',
      { from_number, mobile_number },
      {
        headers: {
          Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzgzLCJ1c2VybmFtZSI6Illhc2h3YW50NjU0OTQiLCJtYWluX3VzZXIiOjEwMzgzLCJpYXQiOjE3Mzk3NzIzOTB9.HKURS7DdnYsizBBDgeTn6E5JpkKk1C8qkuRDL3l3qDE`
        }
      }
    );

    // Extract mobile from response, fallback to user's number if missing
    const responseData = apiResponse.data?.data?.mobile || mobile_number;

    console.log("Final Number (Masked or User’s):", responseData);

    res.status(200).json({
      message: "Call initiated successfully.",
      mobile: responseData
    });

  } catch (error) {
    console.error("Error initiating call:", error.message);

    res.status(500).json({
      message: "Internal server error.",
      error: error.message
    });
  }
};

// Function to update `no_due` in `workersverified` only for workers with a record in `workerlife`
const updateWorkerNoDueStatus = async () => {
  try {
    const updateQuery = `
      UPDATE workersverified wv
      SET no_due = CASE 
        WHEN wl.balance_amount < -50 THEN FALSE  -- If balance is less than -50, set no_due to FALSE
        WHEN wl.balance_amount >= -50 THEN TRUE   -- If balance is -50 or higher, set no_due to TRUE
      END
      FROM workerlife wl
      WHERE wv.worker_id = wl.worker_id;
    `;

    const result = await client.query(updateQuery);
    console.log(`Updated ${result.rowCount} workers' no_due status at 10 AM.`);
  } catch (error) {
    console.error("Error updating no_due status:", error);
  }
};

cron.schedule("0 10 * * *", () => {
  const now = new Date();
  console.log(`Job ran at ${now.toISOString()} (UTC) and ${now.toString()} (local time)`);
  updateWorkerNoDueStatus();
}, {
  timezone: "Asia/Kolkata"
});

const sendDuePaymentNotifications = async () => {
  try {
    // Query to join workerlife and fcm to fetch workers having balance_amount < -50
    const query = `
      SELECT wl.worker_id, wl.balance_amount, f.fcm_token
      FROM workerlife wl
      INNER JOIN fcm f ON wl.worker_id = f.worker_id
      WHERE wl.balance_amount < -50;
    `;
    const result = await client.query(query);

    if (result.rows.length === 0) {
      console.log("No workers with due payments found.");
      return;
    }

    // Group rows by worker_id so that we can send one notification per worker
    const workerMap = new Map();
    for (const row of result.rows) {
      if (!workerMap.has(row.worker_id)) {
        workerMap.set(row.worker_id, {
          balance_amount: row.balance_amount,
          tokens: [row.fcm_token],
        });
      } else {
        workerMap.get(row.worker_id).tokens.push(row.fcm_token);
      }
    }

    // For each worker, build and send the notification message using sendEachForMulticast
    for (const [worker_id, data] of workerMap.entries()) {
      // Calculate the due amount (absolute value of negative balance)
      const dueAmount = Math.abs(data.balance_amount);

      // Build the notification message
      const message = {
        tokens: data.tokens,
        notification: {
          title: "Payment Due",
          body: `Hi, Your payment of ${dueAmount} rupees needs to be paid by 10 AM. If not, you will not receive services until you pay.`,
        },
        data: {
          worker_id: worker_id.toString(),
          dueAmount: dueAmount.toString(),
        },
      };

      try {
        // Send notification using sendEachForMulticast
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`Notification sent to worker ${worker_id} (Tokens: ${data.tokens.join(", ")})`);
        response.responses.forEach((resp, index) => {
          if (!resp.success) {
            console.error(`Error sending to token ${data.tokens[index]}: `, resp.error);
          }
        });
      } catch (error) {
        console.error(`Error sending notification to worker ${worker_id}:`, error);
      }
    }
  } catch (error) {
    console.error("Error fetching due payment workers:", error);
  }
};

// Schedule the function to run every day at 9 AM
cron.schedule("0 9 * * *", () => {
  console.log("Running due payment notification job at 9 AM IST...");
  sendDuePaymentNotifications();
}, {
  timezone: "Asia/Kolkata"
});

const sendLogoutNotificationAndDeleteTokens = async (workerId) => {
  try {
    // Fetch all FCM tokens for the worker
    const fcmQuery = "SELECT fcm_token FROM fcm WHERE worker_id = $1";
    const fcmResult = await client.query(fcmQuery, [workerId]);

    if (fcmResult.rows.length === 0) return; // No active devices

    const tokens = fcmResult.rows.map(row => row.fcm_token);

    // Send FCM logout notification
    const message = {
      tokens,
      notification: {
        title: "Logged Out",
        body: "You have been logged out due to a login on another device.",
      },
      data: { action: "FORCE_LOGOUT" },
    };

    await admin.messaging().sendEachForMulticast(message);
    console.log("Logout notification sent to all previous devices.");

    // Delete all FCM tokens from the fcm table for this worker
    await client.query("DELETE FROM fcm WHERE worker_id = $1", [workerId]);
    console.log(`Deleted all FCM tokens for worker_id: ${workerId}`);

  } catch (error) {
    console.error("Error sending logout notification or deleting FCM tokens:", error);
  }
};

const workerLogout = async (req, res) => {
  try {
      const { fcm_token } = req.body;
      
      console.log("workerlogout",fcm_token)

      if (!fcm_token) {
          return res.status(400).json({ success: false, message: 'FCM token is required' });
      }

      // Delete FCM token from the `fcm` table
      const result = await client.query(
          'DELETE FROM fcm WHERE fcm_token = $1',
          [fcm_token]
      );

      if (result.rowCount > 0) {
          return res.status(200).json({ success: true, message: 'Worker logged out and FCM token deleted' });
      } else {
          return res.status(200).json({ success: false, message: 'worker already logout' });
      }
  } catch (error) {
      console.error('Error in workerLogout:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const userLogout = async (req, res) => {
  try {
      const { fcm_token } = req.body;

      if (!fcm_token) {
          return res.status(400).json({ success: false, message: 'FCM token is required' });
      }

      // Delete FCM token from the `userfcm` table
      const result = await client.query(
          'DELETE FROM userfcm WHERE fcm_token = $1',
          [fcm_token]
      );

      if (result.rowCount > 0) {
          return res.status(200).json({ success: true, message: 'User logged out and FCM token deleted' });
      } else {
          return res.status(200).json({ success: false, message: 'FCM token not found' });
      }
  } catch (error) {
      console.error('Error in userLogout:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const workerTokenVerification = async (req, res) => {
  try {
    const { pcsToken } = req.body;
    const worker_id = req.worker.id; // Ensure worker_id is being extracted correctly



    // Validate input
    if (!pcsToken || !worker_id) {
      return res.status(400).json({ message: "Missing pcsToken or worker_id" });
    }

    // Corrected SQL query with PostgreSQL syntax
    const query = "SELECT session_token FROM workersverified WHERE worker_id = $1";
    const result = await client.query(query, [worker_id]);

    // If worker_id is found in the table
    if (result.rows.length > 0) {
      const { session_token } = result.rows[0];
   

      // Check if the session token matches the provided pcsToken
      if (session_token !== pcsToken) {
        return res.status(205).json({ message: "Session token mismatch" });
      } else {
        
        return res.status(200).json({ message: "Token verified" });
      }
    } else {
      return res.status(200).json({ message: "Worker not verified, proceeding with verification" });
    }
  } catch (error) {
    console.error("Error in workerTokenVerification:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const WorkerSendOtp = (req, res) => {
  const { mobileNumber } = req.body;
  if (!mobileNumber) {
    return res.status(400).json({ message: "Mobile number is required" });
  }

  const options = {
    method: "POST",
    url: `https://cpaas.messagecentral.com/verification/v3/send?countryCode=91&customerId=${process.env.WORKER_CUSTOMER_ID}&flowType=SMS&mobileNumber=${mobileNumber}`,
    headers: {
      authToken: "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJDLTI0OEY5ODhBOUQ5QzQzOCIsImlhdCI6MTc0NTY4Mjk3NywiZXhwIjoxOTAzMzYyOTc3fQ.9-y_44egQuG0MuLs08d7gLWKxkSGW8ldsceKotcrTzP8Dl2XqrSXZGpVtkPJQAL-LJ-HCTPnab1FVHn-A_IJRA",
    },
  };

  request(options, (error, response, body) => {
    if (error) {
      console.error("Error sending OTP:", error);
      return res.status(500).json({ message: "Error sending OTP", error });
    }
    try {
      const data = JSON.parse(body);
      if (data && data.data && data.data.verificationId) {
        return res.status(200).json({
          message: "OTP sent successfully",
          verificationId: data.data.verificationId,
        });
      } else {
        return res.status(500).json({
          message: "Failed to retrieve verificationId",
          error: data,
        });
      }
    } catch (parseError) {
      console.error("Error parsing OTP response:", parseError);
      return res.status(500).json({ message: "Failed to parse response", error: parseError });
    }
  });
};



// WorkerValidateOtp function – Validates the OTP provided by the worker
const WorkerValidateOtp = (req, res) => {
  const { mobileNumber, verificationId, otpCode } = req.query;
  if (!mobileNumber || !verificationId || !otpCode) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  const options = {
    method: "GET",
    url: `https://cpaas.messagecentral.com/verification/v3/validateOtp?countryCode=91&mobileNumber=${mobileNumber}&verificationId=${verificationId}&customerId=${process.env.CUSTOMER_ID}&code=${otpCode}`,
    headers: {
      authToken: "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJDLUIzNzUzRUNBNDNCRDQzNSIsImlhdCI6MTcyNjI1OTQwNiwiZXhwIjoxODgzOTM5NDA2fQ.Gme6ijpbtUge-n9NpEgJR7lIsNQTqH4kDWkoe9Wp6Nnd6AE0jaAKCuuGuYtkilkBrcC1wCj8GrlMNQodR-Gelg",
   },
  };

  request(options, (error, response, body) => {
    if (error) {
      console.error("Error validating OTP:", error);
      return res.status(500).json({ message: "Error validating OTP", error });
    }
    try {
      const data = JSON.parse(body);
      if (data && data.data && data.data.verificationStatus === "VERIFICATION_COMPLETED") {
        return res.status(200).json({ message: "OTP Verified" });
      } else {
        return res.status(200).json({ message: "Invalid OTP" });
      }
    } catch (parseError) {
      console.error("Error parsing OTP validation response:", parseError);
      return res.status(500).json({ message: "Failed to parse response", error: parseError });
    }
  });
};

const accountDelete = async (req, res) => {
  const workerId = req.user.id;
  console.log("worker", workerId);
  try {
    const query = `
      WITH track_data AS (
        SELECT COALESCE(
          (SELECT jsonb_array_length(track)
           FROM useraction
           WHERE user_id = $1
           LIMIT 1),
          0
        ) AS track_length
      ),
      update_query AS (
        UPDATE "user"
        SET phone_number = NULL
        WHERE user_id = $1
          AND (SELECT track_length FROM track_data) = 0
        RETURNING 1
      )
      SELECT json_build_object(
        'status', CASE WHEN EXISTS(SELECT 1 FROM update_query) THEN 200 ELSE 205 END,
        'message', CASE WHEN EXISTS(SELECT 1 FROM update_query)
                          THEN 'User phone number removed successfully.'
                          ELSE 'Account deletion not allowed due to existing track records.'
                     END
      ) AS result;
    `;
    
    const { rows } = await client.query(query, [workerId]);
    const result = rows[0].result;
    return res.status(result.status).json({ message: result.message });
  } catch (error) {
    console.error('Error in accountDelete:', error);
    return res.status(500).json({ message: 'Internal Server Error.' });
  }
};

// Partnerlogin function – Logs in the worker based on database checks
const Partnerlogin = async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) {
    return res.status(400).json({ message: "Phone number is required" });
  } else if (phone_number === "my name is veerappa") {
    return res.status(202).json({ message: "Internal server error" });
  }

  try {
    // Query to check for worker existence in verified and non-verified tables
    const query = `
      WITH workersverified_check AS (
        SELECT worker_id FROM workersverified WHERE phone_number = $1 LIMIT 1
      ),
      workers_check AS (
        SELECT worker_id FROM workers WHERE phone_number = $1 LIMIT 1
      )
      SELECT 
        CASE 
          WHEN EXISTS (SELECT 1 FROM workersverified_check) THEN 200
          WHEN EXISTS (SELECT 1 FROM workers_check) THEN 201
          ELSE 400
        END AS status_code,
        COALESCE(
          (SELECT worker_id FROM workersverified_check), 
          (SELECT worker_id FROM workers_check)
        ) AS worker_id,
        EXISTS (SELECT 1 FROM workers_check) AS step1,
        EXISTS (SELECT 1 FROM workerskills WHERE worker_id = (SELECT worker_id FROM workers_check)) AS step2,
        EXISTS (SELECT 1 FROM bank_accounts WHERE worker_id = (SELECT worker_id FROM workers_check)) AS step3;
    `;
    const result = await client.query(query, [phone_number]);
    const statusCode = result.rows[0].status_code;
    const workerId = result.rows[0].worker_id;
    const stepsCompleted =
      result.rows[0].step1 && result.rows[0].step2 && result.rows[0].step3;

    if (workerId) {
      // Generate a new session token for the worker
      const token = generateWorkerToken({ worker_id: workerId });

      // Update the session token in the database
      await client.query(
        "UPDATE workersverified SET session_token = $1 WHERE worker_id = $2",
        [token, workerId]
      );

      // Optionally, send a logout notification and remove any existing FCM tokens
      await sendLogoutNotificationAndDeleteTokens(workerId);

      if (statusCode === 200) {
        res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "Strict",
        });
        return res.status(200).json({ token, workerId });
      } else if (statusCode === 201) {
        res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "Strict",
        });
        return res.status(201).json({
          message: "Phone number found in workers, please complete sign up",
          token,
          workerId,
          stepsCompleted,
        });
      }
    } else {
      return res.status(203).json({ message: "Phone number not registered", phone_number });
    }
  } catch (error) {
    console.error("Error logging in worker:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const adminLogin = async (req, res) => {
  const { phone_number } = req.query;

  if (!phone_number) {
    return res.status(400).json({ message: "Phone number is required" });
  }

  if (phone_number === "9392365494") {
    // Generate admin token
    const token = generateAdminToken();

    // Send the token in the response
    return res.status(200).json({ token });
  } else {
    return res.status(205).json({ message: "Invalid credentials" });
  }
};

const accountDetailsUpdate = async (req, res) => {
  const userId = req.user.id; // Get user ID from the request
  const { name, email, phone } = req.body; // Get name, email, phone from the request body
  // console.log(userId,name,email,phone)
  try {
    // SQL query to update user details
    const query = `
      UPDATE "user"
      SET name = $1,
          email = $2, 
          phone_number = $3
      WHERE user_id = $4
    `;

    // Execute the query and get the result
    const result = await client.query(query, [name, email, phone, userId]);

    // Check if any row was updated
    if (result.rowCount > 0) {
      return res
        .status(200)
        .json({ message: "Account details updated successfully" });
    } else {
      return res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    console.error("Error updating account details:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const userCompleteSignUp = async (req, res) => {
  const { fullName, email, phoneNumber, referralCode } = req.body;

  if (!fullName || !email || !phoneNumber) {
    return res
      .status(400)
      .json({ message: "Full name, email, and phone number are required" });
  }

  try {
    // Start a transaction
    await client.query("BEGIN");

    // Insert the new user and get the new user_id
    const result = await client.query(
      `
      WITH referrer AS (
        SELECT user_id FROM "user" WHERE referral_code = $1
      ), new_user AS (
        INSERT INTO "user" (name, email, phone_number, referred_by) 
        VALUES ($2, $3, $4, (SELECT user_id FROM referrer)) 
        RETURNING user_id
      ), referral_insert AS (
        INSERT INTO referrals (referrer_user_id, referred_user_id)
        SELECT referrer.user_id, new_user.user_id
        FROM referrer, new_user
        WHERE referrer.user_id IS NOT NULL
        RETURNING referrer_user_id
      )
      SELECT new_user.user_id AS user_id FROM new_user;
      `,
      [referralCode, fullName, email, phoneNumber]
    );

    // Extract the new user_id
    const newUserId = result.rows[0].user_id;

    // Generate a unique referral code for the new user
    const newReferralCode = `CS${newUserId}${crypto
      .randomBytes(2)
      .toString("hex")
      .toUpperCase()}`;

    // Update the user's referral code
    await client.query(
      'UPDATE "user" SET referral_code = $1 WHERE user_id = $2',
      [newReferralCode, newUserId]
    );

    // Commit the transaction
    await client.query("COMMIT");

    // <-- Change: pass user_id property instead of id
    const token = generateToken({ user_id: newUserId, fullName, email });

    // Set the token as an HTTP-only cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
    });

    // Return the response
    return res.status(201).json({
      message: "User registered successfully",
      token,
      referralCode: newReferralCode,
    });
  } catch (error) {
    // Rollback the transaction on error
    await client.query("ROLLBACK");
    console.error("Error in userCompleteSignUp:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const workerCompleteSignUp = async (req, res) => {
  const { fullName, email = null, phoneNumber } = req.body; // Email defaults to null

  if (!phoneNumber) {
    return res.status(400).json({
      message: "No phone number found. Please start the login process again.",
    });
  }

  try {
    // Step 1: Create a contact in Razorpay
    const contactPayload = {
      name: fullName,
      email: email || undefined, // Avoid sending null to Razorpay
      contact: phoneNumber,
      type: "employee",
    };

    const razorpayResponse = await axios.post(
      "https://api.razorpay.com/v1/contacts",
      contactPayload,
      {
        auth: {
          username: process.env.RAZORPAY_KEY,
          password: process.env.RAZORPAY_SECRET,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    // Extract the contact_id from the Razorpay response
    const contact_id = razorpayResponse.data.id;

    // Step 2: Insert the worker and store the contact_id in the database
    const insertWorkerQuery = `
      INSERT INTO workers (phone_number, name, email, contact_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const result = await client.query(insertWorkerQuery, [
      phoneNumber,
      fullName,
      email,
      contact_id,
    ]);

    const worker = result.rows[0];
    const token = generateWorkerToken(worker);

    return res.status(200).json({
      token,
      contact_id,
      message: "Sign up complete",
    });
  } catch (error) {
    console.error("Error completing sign up:", error.response?.data || error.message);
    return res.status(500).json({
      message: "Internal server error",
      error: error.response?.data || error.message,
    });
  }
};

const getServicesPhoneNumber = async (req, res) => {
  // Extract serviceTitle from the body of the POST request
  const worker_id = req.worker.id;

  try {
    // Query to select rows from "services" table where "service_title" matches the provided value
    const query = `
        SELECT sc.*, (
            SELECT array_agg(w.phone_number)
            FROM workers w
            WHERE w.worker_id = $1  -- Use parameterized query for security
        ) AS phone_numbers
        FROM "servicecategories" sc;
    `;
    const result = await client.query(query, [worker_id]);

    // Return the rows that match the query
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).send("Internal Server Error");
  }
};

const getServicesRegisterPhoneNumber = async (req, res) => {
  // Extract serviceTitle from the body of the POST request
  const worker_id = req.worker.id;

  try {
    // Query to select rows from "services" table where "service_title" matches the provided value
    const query = `
        SELECT sc.*, (
            SELECT array_agg(w.phone_number)
            FROM workersverified w
            WHERE w.worker_id = $1  -- Use parameterized query for security
        ) AS phone_numbers
        FROM "servicecategories" sc;
    `;
    const result = await client.query(query, [worker_id]);

    // Return the rows that match the query
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).send("Internal Server Error");
  }
};

const getServiceTrackingWorkerItemDetails = async (req, res) => {
  try {
    const { tracking_id } = req.body;
    console.log(tracking_id);

    if (!tracking_id) {
      return res.status(400).json({ message: "Tracking ID is required" });
    }

    const query = `
      SELECT
        st.service_booked,
        st.service_status,
        st.created_at,
        st.tracking_pin,
        st.total_cost,
        st.discount,  
        st.longitude,
        st.latitude,
        u.name,
        u.phone_number,
        un.area
      FROM servicetracking st
      JOIN "user" u ON st.user_id = u.user_id
      JOIN usernotifications un ON st.user_notification_id = un.user_notification_id
      WHERE st.tracking_id = $1;
    `;
    const result = await client.query(query, [tracking_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "No service tracking details found for the given tracking ID",
      });
    }

    const { service_booked } = result.rows[0];

    if (!Array.isArray(service_booked)) {
      return res
        .status(400)
        .json({ message: "Invalid service_booked data format" });
    }

    return res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error(
      `Error fetching details for tracking_id ${req.body.tracking_id}:`,
      error
    );
    return res.status(500).json({
      message: "Failed to fetch service tracking worker item details",
      error: error.message,
    });
  }
};

const getServiceTrackingUserItemDetails = async (req, res) => {
  try {
    const { tracking_id } = req.body;
    // console.log(tracking_id)
    const query = `
      SELECT
        st.service_booked,
        st.service_status,
        st.created_at,
        st.tracking_pin,
        st.total_cost,
        st.discount, 
        st.data, 
        w.name,
        w.phone_number,
        un.area,
        ws.profile,
        ws.service
      FROM servicetracking st
      JOIN workersverified w ON st.worker_id = w.worker_id
      JOIN usernotifications un ON st.user_notification_id = un.user_notification_id
      JOIN workerskills ws ON w.worker_id = ws.worker_id
      WHERE st.tracking_id = $1;
  `;

    const values = [tracking_id];

    const result = await client.query(query, values);

    // console.log("data",result.rows[0])

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "No service tracking details found for the given accepted ID",
      });
    }

    console.log("data",result.rows[0])
    res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error(
      "Error fetching service tracking worker item details: ",
      error
    );
    res.status(500).json({
      message: "Failed to fetch service tracking worker item details",
      error: error.message,
    });
  }
};

const getServiceBookingItemDetails = async (req, res) => {
  try {
    const { tracking_id } = req.body;
    console.log(tracking_id);
    // console.log(tracking_id)
    const query = `
    SELECT
      st.service_booked,
      st.total_cost,
      st.discount,
      st.time,
      st.created_at,
      w.name,
      w.phone_number,
      un.area,
      ws.profile,
      ws.service
    FROM completenotifications st
    JOIN workersverified w ON st.worker_id = w.worker_id
    JOIN usernotifications un ON st.user_notification_id = un.user_notification_id
    JOIN workerskills ws ON w.worker_id = ws.worker_id
    WHERE st.notification_id = $1;
  `;

    const values = [tracking_id];

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "No service tracking details found for the given accepted ID",
      });
    }

    // const { service_booked } = result.rows[0];

    // if (!service_booked || !Array.isArray(service_booked)) {
    //   return res
    //     .status(400)
    //     .json({ message: "Invalid service_booked data format" });
    // }

    // const gstRate = 0.05;
    // const discountRate = 0.05;

    // const fetchedTotalAmount = service_booked.reduce(
    //   (total, service) => total + (service.cost || 0),
    //   0
    // );

    // const gstAmount = fetchedTotalAmount * gstRate;
    // const cgstAmount = fetchedTotalAmount * gstRate;
    // const discountAmount = fetchedTotalAmount * discountRate;
    // const fetchedFinalTotalAmount =
    //   fetchedTotalAmount + gstAmount + cgstAmount - discountAmount;

    // const paymentDetails = {
    //   gstAmount,
    //   cgstAmount,
    //   discountAmount,
    //   fetchedFinalTotalAmount,
    // };

    res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error(
      "Error fetching service tracking worker item details: ",
      error
    );
    res.status(500).json({
      message: "Failed to fetch service tracking worker item details",
      error: error.message,
    });
  }
};

const getServiceBookingUserItemDetails = async (req, res) => {
  try {
    const { tracking_id } = req.body;
    console.log(tracking_id);
    // console.log(tracking_id)
    const query = `
    SELECT
      st.service_booked,
      st.total_cost,
      st.discount,
      st.time,
      st.created_at,
      w.name,
      w.phone_number,
      un.area,
      w.profile,
    FROM completenotifications st
    JOIN "user" w ON st.user_id = w.user_id
    JOIN usernotifications un ON st.user_notification_id = un.user_notification_id
    WHERE st.notification_id = $1;
  `;

    const values = [tracking_id];

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "No service tracking details found for the given accepted ID",
      });
    }

    res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error(
      "Error fetching service tracking worker item details: ",
      error
    );
    res.status(500).json({
      message: "Failed to fetch service tracking worker item details",
      error: error.message,
    });
  }
};

const getServiceOngoingItemDetails = async (req, res) => {
  try {
    const { tracking_id } = req.body;
    // console.log(tracking_id)
    const query = `
    SELECT
      st.service_booked,
      st.total_cost,
      st.discount,
      st.time,
      st.created_at,
      w.name,
      w.phone_number,
      un.area,
      ws.profile,
      ws.service
    FROM accepted st
    JOIN workersverified w ON st.worker_id = w.worker_id
    JOIN usernotifications un ON st.user_notification_id = un.user_notification_id
    JOIN workerskills ws ON w.worker_id = ws.worker_id
    WHERE st.notification_id = $1;
  `;

    const values = [tracking_id];

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(305).json({
        message: "No service tracking details found for the given accepted ID",
      });
    }

    res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error(
      "Error fetching service tracking worker item details: ",
      error
    );
    res.status(500).json({
      message: "Failed to fetch service tracking worker item details",
      error: error.message,
    });
  }
};

const getServiceOngoingWorkerItemDetails = async (req, res) => {
  try {
    const { tracking_id } = req.body;
    console.log(tracking_id);

    const query = `
      SELECT
        st.service_booked,
        st.total_cost,
        st.discount,
        st.time,
        st.created_at,
        w.name,
        w.phone_number,
        un.area
      FROM accepted st
      JOIN "user" w ON st.user_id = w.user_id
      JOIN usernotifications un ON st.user_notification_id = un.user_notification_id
      WHERE st.notification_id = $1;
    `;

    const values = [tracking_id];

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(305).json({
        message: "No service tracking details found for the given accepted ID",
      });
    }

    res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error(
      "Error fetching service tracking worker item details: ",
      error
    );
    res.status(500).json({
      message: "Failed to fetch service tracking worker item details",
      error: error.message,
    });
  }
};

const serviceTrackingUpdateStatus = async (req, res) => {
  const { tracking_id, newStatus } = req.body;

  try {
    // Validate required fields.
    if (!tracking_id || !newStatus) {
      return res.status(400).json({ message: "tracking_id and newStatus are required." });
    }

    // Update the servicetracking table and return only necessary columns.
    const query = `
      WITH updated AS (
        UPDATE servicetracking 
        SET service_status = $1 
        WHERE tracking_id = $2
        RETURNING tracking_id, service_status, user_id
      )
      SELECT updated.tracking_id, updated.service_status, uf.fcm_token
      FROM updated
      JOIN userfcm uf ON updated.user_id = uf.user_id;
    `;
    
    const values = [newStatus, tracking_id];
    const { rows } = await client.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Service tracking not found." });
    }

    // Extract FCM tokens from the returned rows.
    const tokens = rows.map(row => row.fcm_token);

    // Prepare the multicast message payload.
    const multicastMessage = {
      tokens,
      data: {
        status: newStatus.toString(),
        message: "Service status updated."
      },
      android: {
        priority: "high"
      },
      apns: {
        payload: {
          aps: {
            contentAvailable: true
          }
        }
      }
    };

    // Send notifications using sendEachForMulticast.
    try {
      const fcmResponse = await getMessaging().sendEachForMulticast(multicastMessage);
      fcmResponse.responses.forEach((resp, index) => {
        if (!resp.success) {
          console.error(`Error sending message to token ${tokens[index]}:`, resp.error);
        }
      });

      return res.status(200).json({
        message: "Service status updated successfully and FCM message sent.",
        data: rows[0],
        fcmResponse
      });
    } catch (fcmError) {
      console.error("Error sending notifications:", fcmError);
      return res.status(500).json({ message: "Internal server error", error: fcmError });
    }
  } catch (error) {
    console.error("Error updating service status:", error);
    return res.status(500).json({ message: "Internal Server Error." });
  }
};

const getWorkerDetails = async (req, res) => {
  const { notification_id } = req.body;
  try {
    const query = `
      SELECT 
          accepted.service_booked, 
          accepted.discount,
          accepted.total_cost,
          workersverified.name, 
          usernotifications.area, 
          usernotifications.city, 
          usernotifications.pincode,
          workerskills.profile -- Assuming 'profile' is the correct column name in 'workerskills'
      FROM 
          accepted
      INNER JOIN 
          workersverified ON accepted.worker_id = workersverified.worker_id
      INNER JOIN 
          usernotifications ON accepted.user_notification_id = usernotifications.user_notification_id
      INNER JOIN 
          workerskills ON accepted.worker_id = workerskills.worker_id
      WHERE 
          accepted.notification_id = $1;
    `;

    const result = await client.query(query, [notification_id]);

    if (result.rows.length === 0) {
      return res.json({ error: "No worker details found for the provided notification ID." });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching worker details:", error);
    return res.json({ error: "An error occurred while fetching worker details." });
  }
};

const userProfileDetails = async (req, res) => {
  const userId = req.user.id;
  // console.log(userId);

  try {
    const query = `
      SELECT name, email, phone_number, profile
      FROM "user"
      WHERE user_id = $1;  -- Use $1 as a placeholder for the userId
    `;

    // Execute the query with the userId as a parameter
    const result = await client.query(query, [userId]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No worker details found for the provided user ID." });
    }

    const { name, email, phone_number, profile } = result.rows[0];

    // Return the result
    return res.json({ name, email, phone_number, profile });
  } catch (error) {
    console.error("Error fetching worker details:", error);
    res
      .status(500)
      .json({ message: "An error occurred while fetching worker details." });
  }
};

const workerProfileScreenDetails = async (req, res) => {
  const workerId = req.worker.id;
  // console.log(userId);

  try {
    const query = `
    SELECT w.name, w.email, w.phone_number, ws.profile
    FROM workersverified w
    LEFT JOIN workerskills ws ON w.worker_id = ws.worker_id
    WHERE w.worker_id = $1;
  `;
  

    // Execute the query with the userId as a parameter
    const result = await client.query(query, [workerId]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No worker details found for the provided worker ID." });
    }

    const { name, email, phone_number, profile } = result.rows[0];

    // Return the result
    return res.json({ name, email, phone_number, profile });
  } catch (error) {
    console.error("Error fetching worker details:", error);
    res
      .status(500)
      .json({ message: "An error occurred while fetching worker details." });
  }
};

const profileChangesSubmit = async (req, res) => {
  const { formData, selectedStatus } = req.body;

  console.log("Received formData:", formData);
  console.log("Received selectedStatus:", selectedStatus);

  // Ensure we get a string value for selectedStatus
  const statusValue = typeof selectedStatus === 'object' && selectedStatus.selectedStatus 
    ? selectedStatus.selectedStatus 
    : selectedStatus;
  console.log("Using selectedStatus value:", statusValue);

  // Extract data from formData
  const workerId = req.worker.id;
  console.log("Worker ID:", workerId);
  const profileImageUri = formData.profileImageUri;
  const proofImageUri = formData.proofImageUri;
  const serviceCategory = formData.skillCategory;
  const subskillArray = formData.subSkills; // Assuming this is an array
  const personalDetails = {
    lastName: formData.lastName,
    firstName: formData.firstName,
    gender: formData.gender,
    workExperience: formData.workExperience,
    dob: formData.dob,
    education: formData.education,
  };
  const address = {
    doorNo: formData.doorNo,
    landmark: formData.landmark,
    city: formData.city,
    district: formData.district,
    state: formData.state,
    pincode: formData.pincode,
  };

  try {
    // One multi-statement query using a CTE:
    // 1. Upsert the workerskills row and return worker_id.
    // 2. Update the workers table's issues array for matching category.
    const query = `
      WITH upsert AS (
        INSERT INTO workerskills 
          (worker_id, profile, proof, service, subservices, personalDetails, address)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (worker_id) DO UPDATE
          SET
            profile = EXCLUDED.profile,
            proof = EXCLUDED.proof,
            service = EXCLUDED.service,
            subservices = EXCLUDED.subservices,
            personalDetails = EXCLUDED.personalDetails,
            address = EXCLUDED.address
        RETURNING worker_id
      ),
      update_issues AS (
        UPDATE workers
        SET issues = (
          SELECT jsonb_agg(
            CASE
              WHEN i->>'category' = $8 THEN jsonb_set(i, '{status}', '"changed"')
              ELSE i
            END
          )
          FROM jsonb_array_elements(issues) AS i
        )
        WHERE worker_id = (SELECT worker_id FROM upsert)
        RETURNING *
      )
      SELECT * FROM update_issues;
    `;

    const values = [
      workerId,
      profileImageUri,
      proofImageUri,
      serviceCategory,
      subskillArray,
      personalDetails,
      address,
      statusValue, // Use the extracted string value here
    ];

    console.log("Executing query with values:", values);
    const result = await client.query(query, values);
    console.log("CTE query executed successfully. Update result:", JSON.stringify(result.rows, null, 2));

    // Send success response along with the updated data for debugging
    res.status(200).json({ message: "Registration successful", updatedData: result.rows });
  } catch (error) {
    console.error("Error inserting/updating workerskills or updating issues in workers table:", error);
    res.status(500).json({ message: "Error registering worker", error });
  }
};

const registrationSubmit = async (req, res) => {
  const formData = req.body;
  // Extract data from formData
  const workerId = req.worker.id;
  const profileImageUri = formData.profileImageUri;
  const proofImageUri = formData.proofImageUri;
  const serviceCategory = formData.skillCategory;
  // console.log(profileImageUri,proofImageUri,serviceCategory,formData)
  const subskillArray = formData.subSkills; // Assuming this is an array
  const personalDetails = {
    lastName: formData.lastName,
    firstName: formData.firstName,
    gender: formData.gender,
    workExperience: formData.workExperience,
    dob: formData.dob,
    education: formData.education,
  };
  const address = {
    doorNo: formData.doorNo,
    landmark: formData.landmark,
    city: formData.city,
    district: formData.district,
    state: formData.state,
    pincode: formData.pincode,
  };

  try {
    // SQL query to insert into workerskill table with conflict resolution
    const query = `
          INSERT INTO workerskills (worker_id, profile, proof, service, subservices, personalDetails, address)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (worker_id) DO UPDATE
          SET
              profile = EXCLUDED.profile,
              proof = EXCLUDED.proof,
              service = EXCLUDED.service,
              subservices = EXCLUDED.subservices,
              personalDetails = EXCLUDED.personalDetails,
              address = EXCLUDED.address
      `;

    const values = [
      workerId,
      profileImageUri,
      proofImageUri,
      serviceCategory,
      subskillArray, // Ensure this is compatible with your database schema
      personalDetails,
      address,
    ];

    // Execute the query
    await client.query(query, values);

    // Send success response
    res.status(200).json({ message: "Registration successful" });
  } catch (error) {
    console.error(
      "Error inserting or updating data in workerskill table:",
      error
    );
    res.status(500).json({ message: "Error registering worker", error });
  }
};

const addBankAccount = async (req, res) => {
  const bankAccountDetails = req.body;
  const workerId = req.worker.id;
  const bankName = bankAccountDetails.bank;
  const accountNumber = bankAccountDetails.accountNumber;
  const ifscCode = bankAccountDetails.ifscCode;
  const accountHolderName = bankAccountDetails.accountHolderName;

  if (!bankName || !accountNumber || !ifscCode || !accountHolderName) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    // Call Razorpay API to verify the bank account details.
    // Using the assumed correct endpoint: /v1/bank_accounts/validate
    const razorpayResponse = await axios.post(
      "https://api.razorpay.com/v1/bank_accounts/validate",
      { account_number: accountNumber, ifsc: ifscCode },
      { auth: { username: process.env.RAZORPAY_KEY, password: process.env.RAZORPAY_SECRET } }
    );

    // If Razorpay returns a valid response, consider it verified.
    const verificationResult = razorpayResponse.data;
    console.log("Verification result:", verificationResult);

    // Encrypt sensitive fields
    const encryptedAccountNumber = encrypt(accountNumber);
    const encryptedIfscCode = encrypt(ifscCode);

    // Insert or update the bank account details in the database
    const query = `
      INSERT INTO bankaccounts (worker_id, bank_name, account_number, ifsc_code, account_holder_name, status)
      VALUES ($1, $2, $3, $4, $5, 'verified')
      ON CONFLICT (worker_id) DO UPDATE
      SET
        bank_name = EXCLUDED.bank_name,
        account_number = EXCLUDED.bank_name,  -- Ensure you update with the encrypted value
        ifsc_code = EXCLUDED.ifsc_code,
        account_holder_name = EXCLUDED.account_holder_name,
        status = 'verified',
        updated_at = NOW();
    `;

    const values = [
      workerId,
      bankName,
      encryptedAccountNumber,
      encryptedIfscCode,
      accountHolderName,
    ];

    await client.query(query, values);

    res.status(200).json({ 
      message: "Bank account verified and added successfully", 
      bank_details: verificationResult 
    });
  } catch (error) {
    console.error("Error inserting or updating bank account:", error.response?.data || error.message);
    res.status(500).json({ 
      message: "Error adding account", 
      error: error.response?.data || error.message 
    });
  }
};

const createFundAccount = async (req, res) => {
  try {
    // Get worker id from authentication middleware (assumed to be set on req.worker)
    const { id: worker_id } = req.worker;
    // Get bank account details from the request body
    const { name, ifsc, account_number, bank_name } = req.body;

    // Validate required fields (you can add further validation as needed)
    if (!name || !ifsc || !account_number || !bank_name) {
      return res.status(400).json({ message: "All bank account details are required." });
    }

    // Fetch the worker's Razorpay contact_id from your workers table.
    // (Assume that during signup, a contact_id was created and stored.)
    const contactQuery = "SELECT contact_id FROM workers WHERE worker_id = $1";
    const contactResult = await client.query(contactQuery, [worker_id]);
    if (contactResult.rows.length === 0 || !contactResult.rows[0].contact_id) {
      return res.status(400).json({ message: "Contact ID not found. Create a Razorpay contact first." });
    }
    const contact_id = contactResult.rows[0].contact_id;

    // Build the payload as per Razorpay's Create Fund Account API
    const payload = {
      contact_id,
      account_type: "bank_account",
      bank_account: { name, ifsc, account_number },
    };

    // Call Razorpay's Fund Account API
    const razorpayResponse = await axios.post(
      "https://api.razorpay.com/v1/fund_accounts",
      payload,
      {
        auth: {
          username: process.env.RAZORPAY_KEY,
          password: process.env.RAZORPAY_SECRET,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    // Extract the fund_account_id from Razorpay's response
    const { id: fund_account_id } = razorpayResponse.data;

    // Encrypt sensitive data (e.g. account_number)
    const encryptedAccountNumber = encrypt(account_number);

    // Insert or update the fund account details in your bank_accounts table
    const query = `
      INSERT INTO bank_accounts (worker_id, contact_id, fund_account_id, bank_name, ifsc_code, account_number, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'verified')
      ON CONFLICT (worker_id) DO UPDATE
      SET contact_id = EXCLUDED.contact_id,
          fund_account_id = EXCLUDED.fund_account_id,
          bank_name = EXCLUDED.bank_name,
          ifsc_code = EXCLUDED.ifsc_code,
          account_number = EXCLUDED.account_number,
          status = 'verified',
          updated_at = NOW();
    `;
    const values = [
      worker_id,
      contact_id,
      fund_account_id,
      bank_name,
      ifsc,
      encryptedAccountNumber,
    ];
    await client.query(query, values);

    res.status(200).json({
      success: true,
      message: "Bank account verified and added successfully",
      fund_account_id,
      contact_id,
    });
  } catch (error) {
    console.error("Error creating fund account:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Error adding bank account",
      error: error.response?.data || error.message,
    });
  }
};

const addUpiId = async (req, res) => {
  const workerId = req.worker.id;
  const upiId = req.body.upi_id; // Ensure you're extracting the upi_id from the request body
  // console.log(workerId,req.body)
  try {
    // SQL query to insert into bankaccounts table with conflict resolution
    const query = `
      INSERT INTO bankaccounts (worker_id, upi_id)
      VALUES ($1, $2)
      ON CONFLICT (worker_id) DO UPDATE
      SET
        upi_id = EXCLUDED.upi_id
    `; // Removed the trailing comma

    const values = [workerId, upiId];

    // Execute the query
    await client.query(query, values);

    // Send success response
    res.status(201).json({ message: "Bank account added successfully" });
  } catch (error) {
    console.error(
      "Error inserting or updating data in bank account table:",
      error
    );
    res.status(500).json({ message: "Error adding account", error });
  }
};

const onboardingSteps = async (req, res) => {
  const workerId = req.worker.id; // Get the worker ID from the request object
  try {
    // Query to check existence in workers, workerskills, bank_accounts, and upi_accounts
    const query = `
      SELECT 
        EXISTS (SELECT 1 FROM workers WHERE worker_id = $1) AS step1,
        EXISTS (SELECT 1 FROM workerskills WHERE worker_id = $1) AS step2,
        EXISTS (SELECT 1 FROM bank_accounts WHERE worker_id = $1) AS bankAccount,
        EXISTS (SELECT 1 FROM upi_accounts WHERE worker_id = $1) AS upiId
    `;

    const result = await client.query(query, [workerId]);

    // Extracting step results from the query response
    const { step1, step2, bankaccount, upiid } = result.rows[0];

    // Construct the response object
    const response = {
      step1,
      step2,
      bankAccount: bankaccount, // Step 3A: Bank Account
      upiId: upiid,             // Step 3B: UPI ID
    };

    // Send response
    res.status(200).json({
      message: "Onboarding steps checked successfully",
      steps: response,
    });
  } catch (error) {
    console.error("Error checking onboarding steps:", error);
    res.status(500).json({ message: "Error checking onboarding steps", error });
  }
};

const validateAndSaveUPI = async (req, res) => {
  const { upi_id } = req.body;
  const workerId = req.worker.id;

  console.log("Received request with:", { workerId, upi_id });

  if (!upi_id) {
    return res.status(400).json({
      success: false,
      message: "UPI ID is required.",
    });
  }

  try {
    // Call Razorpay API to validate the UPI ID
    const razorpayResponse = await axios.post(
      "https://api.razorpay.com/v1/payments/validate/vpa",
      { vpa: upi_id },
      {
        auth: {
          username: process.env.RAZORPAY_KEY,
          password: process.env.RAZORPAY_SECRET,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("Razorpay Response:", razorpayResponse.data);

    const validationResponse = razorpayResponse.data;

    // Check if Razorpay validated the UPI ID successfully
    if (validationResponse.success) {
      // Save valid UPI ID to the database
      const query = `
        INSERT INTO upi_accounts (worker_id, upi_id, is_verified, razorpay_response)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (upi_id) DO UPDATE
        SET is_verified = EXCLUDED.is_verified, 
            razorpay_response = EXCLUDED.razorpay_response, 
            updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `;

      const values = [
        workerId,
        upi_id,
        true, // Mark as verified
        JSON.stringify(validationResponse), // Store Razorpay response as JSON
      ];

      const result = await client.query(query, values);
      console.log("UPI ID stored successfully:", result.rows[0]);

      return res.status(200).json({
        success: true,
        message: "UPI ID validated and stored successfully",
        data: result.rows[0],
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "UPI ID validation failed. Please check the UPI ID format.",
      });
    }
  } catch (error) {
    if (error.response) {
      console.error("Error response from Razorpay:", error.response.data);
      return res.status(error.response.status).json({
        success: false,
        message: "UPI ID validation failed",
        error: error.response.data,
      });
    } else {
      console.error("Error message:", error.message);
      return res.status(500).json({
        success: false,
        message: "UPI ID validation or storage failed",
        error: error.message,
      });
    }
  }
};

const getAllBankAccounts = async (req, res) => {
  try {
    // SQL query to select all rows from the bankaccounts table
    const query = "SELECT * FROM bankaccounts";
    const result = await client.query(query);

    // Decrypt the sensitive fields in the retrieved data
    const bankAccounts = result.rows.map((account) => ({
      ...account,
      account_number: decrypt(account.account_number),
      ifsc_code: decrypt(account.ifsc_code),
    }));
    // console.log(bankAccounts)

    // res.status(200).json(bankAccounts);
  } catch (error) {
    console.error("Error retrieving bank accounts:", error);
    // res.status(500).json({ message: 'Error retrieving bank accounts', error });
  }
};

// Function to get worker profile details
// Controller function to get worker profile details
const getWorkerProfileDetails = async (req, res) => {
  const workerId = req.worker.id; // Assuming worker ID is passed as a URL parameter

  try {
    // Query to get worker profile details from workerskills and worker tables
    const query = `
    SELECT 
      ws.worker_id,
      ws.service,
      ws.proof,
      ws.profile,
      ws.subservices,
      COALESCE(wv.phone_number, w.phone_number) AS phone_number,
      ws.personaldetails,
      ws.address
    FROM 
      workerskills ws
    LEFT JOIN 
      workersverified wv ON ws.worker_id = wv.worker_id
    LEFT JOIN 
      workers w ON ws.worker_id = w.worker_id
    WHERE 
      ws.worker_id = $1;
  `;

    const result = await client.query(query, [workerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Worker not found" });
    }

    // Send the response with worker details
    res.status(200).json(result.rows[0]); // Return a single worker's details
  } catch (error) {
    console.error("Error fetching worker profile details:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Optimized function to check worker's onboarding status
const checkOnboardingStatus = async (req, res) => {
  const worker_id = req.worker.id;

  try {
    const { rows } = await client.query(
      "SELECT onboarding_status FROM workersverified WHERE worker_id = $1",
      [worker_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Worker not found" });
    }

    res.status(200).json({ onboarding_status: rows[0].onboarding_status });
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// balanceAmmountToPay function
const balanceAmmountToPay = async (req, res) => {
  const worker_id = req.worker.id; // Assuming worker_id is passed in the request parameters
  // console.log(worker_id)

  try {
    const result = await client.query(
      `
      SELECT 
        servicecall.payment, 
        servicecall.payment_type, 
        servicecall.notification_id, 
        servicecall.end_time, 
        "user".name,
        workerlife.balance_amount,
        workerlife.balance_payment_history
      FROM servicecall
      LEFT JOIN completenotifications 
        ON servicecall.notification_id = completenotifications.notification_id
      LEFT JOIN "user" 
        ON completenotifications.user_id = "user".user_id
      LEFT JOIN workerlife
        ON servicecall.worker_id = workerlife.worker_id
      WHERE servicecall.worker_id = $1 
        AND servicecall.payment IS NOT NULL
      `,
      [worker_id]
    );

    // If there are no records, return a message
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No payments found for this worker" });
    }

    // Return the found records
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching balance amount to pay:", err);
    res
      .status(500)
      .json({ error: "An error occurred while retrieving payments" });
  }
};

const getWorkerCashbackDetails = async (req, res) => {
  try {
    const { worker_id } = req.body; // Get worker_id from the request body
    console.log(worker_id);

    const query = `
      SELECT 
        servicecall.payment, 
        servicecall.payment_type, 
        servicecall.notification_id, 
        servicecall.end_time, 
        completenotifications.*, 
        "user".name,
        workerlife.cashback_history,
        workerlife.cashback_approved_times,
        workerlife.cashback_gain,
        (
          SELECT jsonb_agg(history)
          FROM jsonb_array_elements(workerlife.cashback_history) AS history
        ) AS cashback_history
      FROM servicecall
      LEFT JOIN completenotifications 
        ON servicecall.notification_id = completenotifications.notification_id
      LEFT JOIN "user" 
        ON completenotifications.user_id = "user".user_id
      LEFT JOIN workerlife 
        ON servicecall.worker_id = workerlife.worker_id
      WHERE servicecall.worker_id = $1 
        AND servicecall.payment IS NOT NULL;
    `;

    const values = [worker_id];
    const result = await client.query(query, values);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching worker cashback details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const getWorkerBalanceDetails = async (req, res) => {
  try {
    const { worker_id } = req.body; // Get worker_id from the request body
    console.log(worker_id);

    const query = `
    SELECT 
      servicecall.payment, 
      servicecall.payment_type, 
      servicecall.notification_id, 
      "user".name,
      "user".phone_number,
      workerlife.cashback_history,
      workerlife.balance_payment_history  -- Updated field name (if applicable)
    FROM servicecall
    LEFT JOIN completenotifications 
      ON servicecall.notification_id = completenotifications.notification_id
    LEFT JOIN "user" 
      ON completenotifications.user_id = "user".user_id
    LEFT JOIN workerlife 
      ON servicecall.worker_id = workerlife.worker_id
    WHERE servicecall.worker_id = $1 
      AND servicecall.payment IS NOT NULL;
  `;

    const values = [worker_id];
    const result = await client.query(query, values);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching worker cashback details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const pendingBalanceWorkers = async (req, res) => {
  try {
    const query = `
      SELECT 
        wl.balance_amount, 
        wl.worker_id,
        ws.profile,
        ws.service,
        wv.name
      FROM workerlife wl
      LEFT JOIN workerskills ws ON wl.worker_id = ws.worker_id
      LEFT JOIN workersverified wv ON wl.worker_id = wv.worker_id
      WHERE wl.balance_amount != 0.00;
    `;

    const result = await client.query(query);

    // Send the results as JSON
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching pending balance worker details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const getDashboardDetails = async (req, res) => {
  try {
    const { date, startDate, endDate } = req.body;

    // Prepare the query and values based on the input
    let dateCondition;
    const values = [];

    if (date) {
      // Single date condition
      dateCondition = `= $1`;
      values.push(date);
    } else if (startDate && endDate) {
      // Date range condition
      dateCondition = `BETWEEN $1 AND $2`;
      values.push(startDate, endDate);
    } else {
      return res.status(400).json({
        error:
          "Please provide either 'date' or both 'startDate' and 'endDate'.",
      });
    }

    const query = `
      SELECT 
        -- Count of worker_id in workersverified within date range
        (SELECT COUNT(worker_id) FROM workersverified WHERE DATE(created_at) ${dateCondition}) AS worker_count,
        
        -- Count of user_id in "user" within date range
        (SELECT COUNT(user_id) FROM "user" WHERE DATE(created_at) ${dateCondition}) AS user_count,
        
        -- Count of completed services in completenotifications within date range
        (SELECT COUNT(*) FROM completenotifications WHERE DATE(created_at) ${dateCondition} ) AS services,
        
        -- Count of canceled services in completenotifications within date range
        (SELECT COUNT(*) FROM completenotifications WHERE DATE(created_at) ${dateCondition} AND complete_status = 'cancel') AS cancel_services,
        
        -- Sum of all balance_amount in workerlife
        (SELECT COALESCE(SUM(balance_amount), 0) FROM workerlife) AS total_balance_amount,
        
        -- Count of rows in workerlife where balance_amount is not 0.00
        (SELECT COUNT(*) FROM workerlife WHERE balance_amount != 0.00) AS non_zero_balance_count
    `;

    const result = await client.query(query, values);

    // Return results as JSON response
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching dashboard details:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const insertRelatedService = async (req, res) => {
  const { service, service_category, related_services } = req.body;

  // SQL query to insert data into the 'relatedservices' table
  const query = `
    INSERT INTO relatedservices (service, service_category, related_services)
    VALUES ($1, $2, $3) RETURNING *;
  `;

  // Values to be inserted into the query
  const values = [service, service_category, related_services];

  try {
    // Execute the query
    const result = await client.query(query, values);

    // Send a success response with the inserted row details
    res.status(201).json({
      message: "Related service added successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error inserting related service:", error);

    // Send an error response if something goes wrong
    res.status(500).json({
      message: "Error adding related service",
      error: error.message,
    });
  }
};

const insertTracking = async (req, res) => {
  try {
    const { notification_id, details } = req.body;

    // Generate a 4-digit random number for tracking_pin
    const trackingPin = Math.floor(1000 + Math.random() * 9000);

    // Generate a tracking_key: #cs followed by 13 random digits
    const trackingKey = `#cs${Math.floor(
      1000000000000 + Math.random() * 9000000000000
    )}`;

    // Set service_status as "Commander collected the service item"
    const serviceStatus = "Collected Item";

    const query = `
      WITH selected AS (
        SELECT
          a.accepted_id,
          a.notification_id,
          a.user_notification_id,
          a.longitude,
          a.latitude,
          a.worker_id,
          a.service_booked,
          a.user_id,
          a.total_cost,
          a.discount,
          a.tip_amount,
          u.fcm_token
        FROM accepted a
        JOIN userfcm u ON a.user_id = u.user_id
        WHERE a.notification_id = $1
      )
      INSERT INTO servicetracking (
        accepted_id,
        notification_id,
        user_notification_id,
        longitude,
        latitude,
        worker_id,
        service_booked,
        user_id,
        total_cost,
        discount,
        tip_amount,
        created_at,
        tracking_pin,
        tracking_key,
        service_status,
        data
      )
      SELECT
        selected.accepted_id,
        selected.notification_id,
        selected.user_notification_id,
        selected.longitude,
        selected.latitude,
        selected.worker_id,
        selected.service_booked,
        selected.user_id,
        selected.total_cost,
        selected.discount,
        selected.tip_amount,
        NOW(),
        $2,
        $3,
        $4,
        $5::jsonb
      FROM selected
      ON CONFLICT (accepted_id) DO NOTHING
      RETURNING 
        accepted_id,
        notification_id,
        user_notification_id,
        longitude,
        latitude,
        worker_id,
        service_booked,
        user_id,
        total_cost,
        discount,
        tip_amount,
        created_at,
        tracking_pin,
        tracking_key,
        service_status,
        data,
        (SELECT ARRAY_AGG(fcm_token) FROM selected) AS fcm_tokens;
    `;
    
    const values = [
      notification_id,
      trackingPin,
      trackingKey,
      serviceStatus,
      details, // This should be a valid JSON string/object
    ];
    
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(400).json({ 
        message: "Tracking for this notification_id already exists." 
      });
    }

    const { user_id, service_booked, worker_id } = result.rows[0];
    const screen = "";
    const encodedId = Buffer.from(notification_id.toString()).toString("base64");

    await createUserBackgroundAction(user_id, encodedId, screen, service_booked);
    await updateWorkerAction(worker_id, encodedId, screen);

    const fcmTokens = result.rows
      .map((row) => row.fcm_tokens)
      .flat()
      .filter((token) => token);

    if (fcmTokens.length > 0) {
      const multicastMessage = {
        tokens: fcmTokens,
        notification: {
          title: "Click Solver",
          body: `Commander collected your Item to repair in his location.`,
        },
        data: {
          screen: "Home",
        },
      };

      try {
        const response = await getMessaging().sendEachForMulticast(multicastMessage);
        response.responses.forEach((res, index) => {
          if (!res.success) {
            console.error(
              `Error sending message to token ${fcmTokens[index]}:`,
              res.error
            );
          }
        });
      } catch (error) {
        console.error("Error sending notifications:", error);
      }
    } else {
      console.error("No FCM tokens to send the message to.");
    }

    res.status(201).json({
      message: "Tracking inserted successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error inserting tracking: ", error);
    res
      .status(500)
      .json({ message: "Failed to insert tracking", error: error.message });
  }
};

const getWorkerTrackingServices = async (req, res) => {
  try {
    const workerId = req.worker.id;

    // SQL query to fetch service_status, created_at, tracking_id from servicetracking
    // and join with workerskills table to get service
    const query = `
      SELECT
        st.service_status,
        st.created_at,
        st.tracking_id,
        st.tracking_key,
        ws.service
      FROM servicetracking st
      JOIN workerskills ws ON st.worker_id = ws.worker_id
      WHERE st.worker_id = $1;
    `;

    const values = [workerId];

    // Execute the query
    const result = await client.query(query, values);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching worker tracking services: ", error);
    res.status(500).json({
      message: "Failed to fetch worker tracking services",
      error: error.message,
    });
  }
};

const workerMessage = async (req, res) => {
  try {
    const { worker_id, message } = req.body;

    if (!worker_id || !message) {
      return res.status(400).json({ error: "worker_id and message are required" });
    }

    // Fetch FCM tokens for the worker
    const fcmQuery = `SELECT fcm_token FROM fcm WHERE worker_id = $1;`;
    const { rows } = await client.query(fcmQuery, [worker_id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "No FCM tokens found for this worker." });
    }

    // Extract FCM tokens
    const fcmTokens = rows.map(row => row.fcm_token);

    // Construct the FCM multicast message
    const multicastMessage = {
      tokens: fcmTokens, // Sending to multiple tokens
      notification: {
        title: "Payment Reminder",
        body: message,
      },
      android: {
        priority: "high",
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    };

    // Send message using Firebase Admin SDK
    try {
      const response = await getMessaging().sendEachForMulticast(multicastMessage);

      // Log failures if any
      response.responses.forEach((res, index) => {
        if (!res.success) {
          console.error(`Error sending message to token ${fcmTokens[index]}:`, res.error);
        }
      });

      return res.status(200).json({
        success: true,
        message: "Message sent successfully",
        response: response.responses,
      });

    } catch (error) {
      console.error("Error sending notifications:", error);
      return res.status(500).json({ error: "Failed to send message" });
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const callMasking = async (req, res) => {
  try {
    // Dummy data for demonstration
    const workerNumber = "9392365494";       // Worker's actual phone number
    const customerNumber = "7981793632";      // Customer's actual phone number
    const virtualDID = "8071500945";           // Virtual DID (provided DID)
    const channelID = "3";                   // Channel id for the given DID
    const eventID = "uniqueEventID_" + Date.now(); // Unique event ID for tracking

    // Build the payload according to Bonvoice AutoCall API
    const payload = {
      autocallType: "3",               // Dial single number mode
      destination: workerNumber,       // Call is initiated to the worker
      ringStrategy: "ringall",         // Ring strategy
      legACallerID: virtualDID,        // Virtual number to mask caller's real number (worker)
      legAChannelID: channelID,
      legADialAttempts: "1",
      legBDestination: customerNumber, // Customer number to be called once worker picks up
      legBCallerID: virtualDID,        // Virtual number to mask customer's real number
      legBChannelID: channelID,
      legBDialAttempts: "1",
      eventID: eventID                 // Unique identifier for the call
    };

    // API endpoint for Bonvoice AutoCall API
    const url = 'https://backend.pbx.bonvoice.com/autoDialManagement/autoCallBridging/';

    // HTTP headers including the provided token
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Token ff7f0eb0ed9bc1295ac7e0d7b7a643e0a2348b37'
    };

    // Make the POST request to initiate the call
    const response = await axios.post(url, payload, { headers });

    // If successful, return the virtual DID which the worker should call
    return res.status(200).json({
      message: 'Call masking initiated successfully. Please dial the virtual DID.',
      dialNumber: virtualDID,
      data: response.data
    });
  } catch (error) {
    console.error('Error in callMasking:', error.message);
    return res.status(500).json({
      message: 'Error initiating call masking',
      error: error.message
    });
  }
};

const getAllTrackingServices = async (req, res) => {
  try {
    console.log("Hi");
    // SQL query to fetch service_status, created_at, tracking_id from servicetracking
    // and join with workerskills table to get service
    const query = `
    SELECT
      st.service_status,
      st.created_at,
      st.tracking_id,
      ws.service
    FROM servicetracking st
    LEFT JOIN workerskills ws ON st.worker_id = ws.worker_id
  `;

    // Execute the query
    const result = await client.query(query);


    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching worker tracking services: ", error);
    res.status(500).json({
      message: "Failed to fetch worker tracking services",
      error: error.message,
    });
  }
};

const serviceDeliveryVerification = async (req, res) => {
  const { trackingId, enteredOtp } = req.body;

  if (!trackingId || !enteredOtp) {
    return res
      .status(400)
      .json({ message: "Tracking ID and OTP are required" });
  }

  try {
    const query = `
      WITH fetched_data AS (
        SELECT 
          st.tracking_pin, 
          st.notification_id
        FROM servicetracking st
        WHERE st.tracking_id = $1
      ),
      update_accepted AS (
        UPDATE accepted a
        SET 
          time = jsonb_set(
            COALESCE(a.time, '{}'::jsonb),
            '{workCompleted}',
            to_jsonb(to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
          )
        WHERE a.notification_id = (SELECT notification_id FROM fetched_data)
          AND (SELECT tracking_pin FROM fetched_data) = $2
        RETURNING a.time
      )
      SELECT 
        (SELECT notification_id FROM fetched_data) AS notification_id,
        EXISTS (SELECT 1 FROM update_accepted) AS otp_verified
      ;
    `;

    const result = await client.query(query, [trackingId, enteredOtp]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Tracking ID not found" });
    }

    const { notification_id, otp_verified } = result.rows[0];

    if (otp_verified) {
      const encodedId = Buffer.from(notification_id.toString()).toString(
        "base64"
      );
      return res.status(200).json({
        message: "OTP verified successfully",
        encodedId,
      });
    } else {
      return res.status(400).json({ message: "Invalid OTP" });
    }
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

const getUserTrackingServices = async (req, res) => {
  try {
    const userId = req.user.id;

    // SQL query to fetch service_status, created_at, tracking_id from servicetracking
    // and join with workerskills table to get service
    const query = `
      SELECT
        st.service_status,
        st.created_at,
        st.tracking_id,
        st.tracking_key,
        ws.service
      FROM servicetracking st
      JOIN workerskills ws ON st.worker_id = ws.worker_id
      WHERE st.user_id = $1;
    `;

    const values = [userId];

    // Execute the query
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(205).json({
        message: "No tracking services found for the given notification ID",
      });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching worker tracking services: ", error);
    res.status(500).json({
      message: "Failed to fetch worker tracking services",
      error: error.message,
    });
  }
};

const getPendingWorkers = async (req, res) => {
  try {
    const query = `
    SELECT 
      w.worker_id,
      w.verification_status,
      w.created_at,
      w.issues
    FROM workers w
    INNER JOIN workerskills ws ON w.worker_id = ws.worker_id
    WHERE w.worker_id IS NOT NULL;
  `;
  

    const { rows } = await client.query(query);
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching pending workers:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getPendingWorkersNotStarted = async (req, res) => {
  try {
    const query = `
    SELECT 
      w.worker_id,
      w.phone_number,
      w.verification_status,
      w.created_at,
      w.issues
    FROM workers w
    LEFT JOIN workerskills ws ON w.worker_id = ws.worker_id
    WHERE ws.worker_id IS NULL;

  `;
  

    const { rows } = await client.query(query);
    console.log(rows)
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching pending workers:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getPendingWorkerDetails = async (req, res) => {
  try {
    const { workerId } = req.body;

    const query = `
      SELECT 
        w.worker_id,
        w.name,
        w.phone_number,
        w.verification_status,
        w.issues,
        ws.proof,
        ws.profile,
        ws.service,
        ws.subservices,
        ws.personaldetails,
        ws.address
      FROM workers w
      INNER JOIN workerskills ws ON w.worker_id = ws.worker_id
      WHERE w.worker_id = $1;
    `;

    const { rows } = await client.query(query, [workerId]);
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching pending worker details:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateIssues = async (req, res) => {
  const { workerId, issues } = req.body;

  if (!workerId || !issues) {
    return res
      .status(400)
      .json({ message: "workerId and issues are required." });
  }

  try {
    // Use a CTE to update the worker's issues and then retrieve all FCM tokens
    const query = `
      WITH updated AS (
        UPDATE workers
        SET issues = $2::jsonb
        WHERE worker_id = $1
      )
      SELECT fcm_token FROM fcm;
    `;
    const result = await client.query(query, [workerId, JSON.stringify(issues)]);
    const tokens = result.rows.map(row => row.fcm_token);

    // If tokens exist, send notifications to all devices
    if (tokens.length > 0) {
      const message = {
        notification: {
          title: 'Issue Updated',
          body: 'Worker issues have been updated.',
        },
        data: {
          screen: "ApprovalScreen", // Ensure IDs are strings
          issues: JSON.stringify(issues), // Send issues as a string
          type: "issue_update", // Example custom type
          timestamp: new Date().toISOString(), // Timestamp for reference
        },
        tokens: tokens, // Sends the notification to all retrieved tokens
      };

      try {
        // If using Firebase Admin SDK's sendEachForMulticast:
        const response = await admin.messaging().sendEachForMulticast(message);
        response.responses.forEach((resp, index) => {
          if (!resp.success) {
            console.error(`Error sending to token ${user_fcm_tokens[index]}: `, resp.error);
          }
        });
        console.log(`Notifications sent to user_id: ${user_id}`);
      } catch (err) {
        console.error("Error sending user payment notification:", err);
      }
      console.log('Notification response:', response);
    }

    return res.status(200).json({
      message: "Issues updated and notifications sent successfully."
    });
  } catch (error) {
    console.error("Error updating issues:", error);
    return res
      .status(500)
      .json({ message: "An error occurred while updating issues." });
  }
};

const updateApproveStatus = async (req, res) => {
  const { newStatus, workerId } = req.body;

  if (!newStatus || !workerId) {
    return res
      .status(400)
      .json({ message: "status and workerId are required." });
  }

  try {
    // Update the verification_status for the specified worker_id
    const query = `
          UPDATE workers
          SET verification_status = $1
          WHERE worker_id = $2
      `;

    // Execute the query
    const result = await client.query(query, [newStatus, workerId]);

    // Check if any rows were updated
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Worker not found." });
    }

    return res
      .status(200)
      .json({ message: "Verification status updated successfully." });
  } catch (error) {
    console.error("Error updating verification status:", error);
    return res.status(500).json({
      message: "An error occurred while updating verification status.",
    });
  }
};

const checkApprovalVerificationStatus = async (req, res) => {
  const workerId = req.worker.id;

  if (!workerId) {
    return res.status(400).json({ message: "workerId is required." });
  }

  try {
    const query = `
      SELECT 
        t.source,
        t.name,
        t.issues,
        t.verification_status,
        ws.service,
        ws.profile
      FROM (
        SELECT worker_id, 'workers' AS source, name, issues, verification_status
        FROM workers
        WHERE worker_id = $1
        UNION ALL
        SELECT worker_id, 'workersverified' AS source, NULL AS name, NULL AS issues, NULL AS verification_status
        FROM workersverified
        WHERE worker_id = $1
      ) t
      LEFT JOIN workerskills ws ON t.worker_id = ws.worker_id
      LIMIT 1;
    `;
    
    const result = await client.query(query, [workerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Worker not found." });
    }

    const workerData = result.rows[0];
    console.log(workerData);

    if (workerData.source === "workersverified") {
      return res.status(201).json({ message: "Worker is verified." });
    }

    return res.status(200).json({
      name: workerData.name,
      issues: workerData.issues,
      verification_status: workerData.verification_status,
      service: workerData.service,
      profile: workerData.profile,
    });
  } catch (error) {
    console.error("Error fetching approval verification status:", error);
    return res.status(500).json({
      message: "An error occurred while fetching approval verification status.",
    });
  }
};

const workerApprove = async (req, res) => {
  const { workerId } = req.body;

  if (!workerId) {
    return res.status(400).json({ error: "workerId is required." });
  }

  try {
    // Single query with multiple CTEs:
    // 1. Delete from workers, returning worker details
    // 2. Insert the returned row into workersverified
    // 3. Insert the same worker_id into workerlife
    // 4. Finally, select fcm_token for that worker
    const query = `
      WITH moved_worker AS (
        DELETE FROM workers
        WHERE worker_id = $1
        RETURNING worker_id, name, email, phone_number, contact_id
      ),
      inserted_worker AS (
        INSERT INTO workersverified (worker_id, name, email, phone_number, contact_id)
        SELECT worker_id, name, email, phone_number, contact_id 
        FROM moved_worker
        RETURNING worker_id
      ),
      life_insert AS (
        INSERT INTO workerlife (worker_id)
        SELECT worker_id
        FROM inserted_worker
        RETURNING worker_id
      )
      SELECT fcm_token 
      FROM fcm
      WHERE worker_id IN (SELECT worker_id FROM inserted_worker);
    `;

    const result = await client.query(query, [workerId]);

    // If no rows returned, the worker wasn't found or is already verified
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Worker not found or already verified" });
    }

    // Extract tokens from the result
    const tokens = result.rows.map(row => row.fcm_token);

    // If tokens exist, send a notification to the worker
    if (tokens.length > 0) {
      const message = {
        notification: {
          title: 'Account Approved',
          body: 'Your account is approved and now you are a family in ClickSolver!',
        },
        data: {
          screen: "ApprovalScreen",
          type: "account_approved",
          timestamp: new Date().toISOString(),
        },
        tokens: tokens,
      };

      try {
        // Using Firebase Admin SDK's sendEachForMulticast
        const response = await admin.messaging().sendEachForMulticast(message);
        response.responses.forEach((resp, index) => {
          if (!resp.success) {
            console.error(`Error sending to token ${tokens[index]}: `, resp.error);
          }
        });
        console.log('Notifications sent to user');
      } catch (err) {
        console.error("Error sending user notification:", err);
      }
    }

    return res
      .status(200)
      .json({ message: "Worker approved, moved to workersverified, and added to workerlife." });
  } catch (error) {
    console.error("Error in workerApprove:", error.message);
    return res
      .status(500)
      .json({ error: "An error occurred while approving the worker" });
  }
};

const sendMessageWorker = async (req, res) => {
  const { request_id, senderType, message } = req.body;

  try {
    // Prepare the new message object as a JSON string wrapped in an array
    const newMessageJSON = JSON.stringify([{
      key: senderType,
      message,
      timestamp: new Date().toISOString(),
    }]);

    /*  
      This query performs the following in one step:
      1. In the CTE "accepted_data": Joins the "accepted" and "fcm" tables to retrieve the worker_id,
         current messages, and aggregates the FCM tokens.
      2. In the CTE "updated": Updates the "accepted" table by appending the new message (as JSONB)
         to the messages column.
      3. Finally, selects the updated messages and tokens.
    */
    const query = `
      WITH accepted_data AS (
        SELECT a.worker_id, a.messages, array_agg(f.fcm_token) AS tokens
        FROM accepted a
        JOIN fcm f ON a.worker_id = f.worker_id
        WHERE a.notification_id = $1
        GROUP BY a.worker_id, a.messages
      ),
      updated AS (
        UPDATE accepted
        SET messages = COALESCE(messages, '[]'::jsonb) || $2::jsonb
        WHERE notification_id = $1
        RETURNING messages
      )
      SELECT updated.messages, accepted_data.tokens
      FROM updated
      JOIN accepted_data ON true;
    `;
    
    const values = [request_id, newMessageJSON];
    const result = await client.query(query, values);

    console.log("Rows updated:", result.rowCount);

    if (result.rowCount === 0) {
      return res.status(205).json({ error: 'Request not found or update failed' });
    }

    const updatedMessages = result.rows[0].messages;
    const fcmTokens = result.rows[0].tokens; // array of FCM tokens

    // Prepare multicast payload
    const multicastMessage = {
      tokens: fcmTokens,
      notification: {
        title: senderType === 'user' ? 'User sent a message' : 'Worker sent a message',
        body: message,
      },
      data: {
        request_id: String(request_id),
        senderType,
        message,
      },
    };

    // Send notifications using sendEachForMulticast
    const response = await getMessaging().sendEachForMulticast(multicastMessage);
    response.responses.forEach((resp, index) => {
      if (!resp.success) {
        console.error(`Error sending message to token ${fcmTokens[index]}:`, resp.error);
      }
    });

    return res.status(200).json({
      message: 'Message stored and FCM notification sent successfully!',
      messages: updatedMessages,
      fcmResponse: response,
    });
  } catch (error) {
    console.error('Error in sendMessageWorker:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

const sendMessageUser = async (req, res) => {
  const { request_id, senderType, message } = req.body;
  console.log("Received request:", req.body);

  try {
    // Prepare the new message object as a JSON string wrapped in an array
    const newMessageJSON = JSON.stringify([{
      key: senderType,
      message,
      timestamp: new Date().toISOString(),
    }]);

    /*  
      This query performs the following in one step:
      1. In the CTE "accepted_data": Joins the "accepted" and "fcm" tables to retrieve the worker_id,
         current messages, and aggregates the FCM tokens.
      2. In the CTE "updated": Updates the "accepted" table by appending the new message (as JSONB)
         to the messages column.
      3. Finally, selects the updated messages and tokens.
    */
    const query = `
      WITH accepted_data AS (
        SELECT a.user_id, a.messages, array_agg(f.fcm_token) AS tokens
        FROM accepted a
        JOIN userfcm f ON a.user_id = f.user_id
        WHERE a.notification_id = $1
        GROUP BY a.user_id, a.messages
      ),
      updated AS (
        UPDATE accepted
        SET messages = COALESCE(messages, '[]'::jsonb) || $2::jsonb
        WHERE notification_id = $1
        RETURNING messages
      )
      SELECT updated.messages, accepted_data.tokens
      FROM updated
      JOIN accepted_data ON true;
    `;
    
    const values = [request_id, newMessageJSON];
    const result = await client.query(query, values);

    console.log("Rows updated:", result.rowCount);

    if (result.rowCount === 0) {
      return res.status(205).json({ error: 'Request not found or update failed' });
    }

    const updatedMessages = result.rows[0].messages;
    const fcmTokens = result.rows[0].tokens; // array of FCM tokens

    // Prepare multicast payload
    const multicastMessage = {
      tokens: fcmTokens,
      notification: {
        title: senderType === 'user' ? 'User sent a message' : 'Worker sent a message',
        body: message,
      },
      data: {
        request_id: String(request_id),
        senderType,
        message,
      },
    };

    // Send notifications using sendEachForMulticast
    const response = await getMessaging().sendEachForMulticast(multicastMessage);
    response.responses.forEach((resp, index) => {
      if (!resp.success) {
        console.error(`Error sending message to token ${fcmTokens[index]}:`, resp.error);
      }
    });

    return res.status(200).json({
      message: 'Message stored and FCM notification sent successfully!',
      messages: updatedMessages,
      fcmResponse: response,
    });
  } catch (error) {
    console.error('Error in sendMessageWorker:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

const workerGetMessage = async (req, res) => {
  const { request_id } = req.query;


  try {
    const query = `
      SELECT messages 
      FROM accepted 
      WHERE notification_id = $1
    `;
    const values = [request_id];

    const result = await client.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const messages = result.rows[0].messages;
    return res.status(200).json({ messages });
  } catch (error) {
    console.error('Error in workerGetMessage:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

const getWorkersPendingCashback = async (req, res) => {
  try {
    const query = `
      SELECT 
        w.worker_id,
        w.cashback_approved_times - w.cashback_gain AS pending_cashback,
        v.name,
        v.created_at,
        s.service,
        s.profile
      FROM workerlife AS w
      JOIN workersverified AS v ON w.worker_id = v.worker_id
      JOIN workerskills AS s ON w.worker_id = s.worker_id
      WHERE (w.cashback_approved_times - w.cashback_gain) > 0;
    `;

    const result = await client.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching pending cashback for workers:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const workerCashbackPayed = async (req, res) => {
  const { worker_id, cashbackCount, cashbackPayed } = req.body;
  console.log(worker_id, cashbackPayed, cashbackCount);
  try {
    const currentTime = new Date().toISOString();

    const query = `
      WITH updated_worker AS (
        UPDATE workerlife
        SET cashback_gain = cashback_gain + $1,
            cashback_history = cashback_history || $2::jsonb
        WHERE worker_id = $3
        RETURNING cashback_gain, cashback_history
      )
      SELECT * FROM updated_worker;
    `;

    // Construct the new cashback history entry as a JSON object
    const newHistoryEntry = JSON.stringify([
      {
        amount: cashbackPayed,
        time: currentTime,
        paid: "Paid by Click Solver",
        count: cashbackCount,
        status: "success",
      },
    ]);

    // Execute the query with parameters
    const { rows } = await client.query(query, [
      cashbackCount,
      newHistoryEntry,
      worker_id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Worker not found" });
    }

    // Send the updated cashback information as response
    res.status(200).json({
      message: "Cashback updated successfully",
      cashback_gain: rows[0].cashback_gain,
      cashback_history: rows[0].cashback_history,
    });
  } catch (error) {
    console.error("Error updating cashback:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// optimized functions
const getServiceByName = async (req, res) => {
  const { serviceName } = req.body; // Get the service name from the request body
  if (!serviceName) {
    return res.status(400).json({ error: "Service name is required" });
  }

  try {
    const query = `
    SELECT 
      a.main_service_id, 
      a.cost, 
      a.service_tag, 
      a.service_details, 
      r.service_urls
    FROM allservices a
    JOIN (
        SELECT 
          r.related_services, 
          r.service_urls,
          ARRAY(SELECT jsonb_array_elements_text(r.related_services)) AS related_services_arr
        FROM relatedservices r
        WHERE r.service_category = $1
    ) AS r 
      ON a.service_tag = ANY(r.related_services_arr)
    ORDER BY array_position(r.related_services_arr, a.service_tag);
  `;
  
  

    const result = await client.query(query, [serviceName]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    // Extract the main service (first row) and the related services (all matching rows)
    const serviceData = result.rows[0]; // First matching row is the main service
    const relatedServicesData = result.rows; // All rows including the first are related services

    // Return the service and related services as response
    res.status(200).json({
      service: serviceData, // The primary service
      relatedServices: relatedServicesData, // All related services including the primary one
    });
  } catch (error) {
    console.error("Error fetching service:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching the service" });
  }
};

const getAllLocations = async (workerIds) => {
  try {
    if (workerIds.length < 1) {
      return [];
    }
    const locationsRef = db.collection("locations");

    // Create a query to filter documents where workerId is in the workerIds array
    const query = locationsRef.where("worker_id", "in", workerIds);

    const snapshot = await query.get();

    if (snapshot.empty) {
      return [];
    }

    let locations = [];
    snapshot.forEach((doc) => {
      locations.push({ id: doc.id, ...doc.data() });
    });
    // console.log(locations)
    return locations;
  } catch (error) {
    console.error("Error getting locations:", error);
    return [];
  }
};

const getWorkerLocation = async (workerId) => {
  try {
    if (!workerId) {
      return [];
    }

    const locationsRef = db.collection("locations");
    const query = locationsRef.where("worker_id", "==", workerId);

    const snapshot = await query.get();

    if (snapshot.empty) {
      return [];
    }

    let locations = [];
    snapshot.forEach((doc) => {
      locations.push({ id: doc.id, ...doc.data() });
    });
    // console.log(locations);
    return locations;
  } catch (error) {
    console.error("Error getting location:", error);
    return [];
  }
};

const getUserAndWorkerLocation = async (req, res) => {
  const { notification_id } = req.body;

  try {
    // Step 1: Get user longitude, latitude, and worker_id from accepted table using notification_id
    const query = `
      SELECT longitude, latitude, worker_id 
      FROM accepted 
      WHERE notification_id = $1
    `;
    const result = await client.query(query, [notification_id]);

    // Check if the notification exists in the table
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const {
      longitude: userLongitude,
      latitude: userLatitude,
      worker_id,
    } = result.rows[0];

    // Step 2: Query Firestore for the worker's location by worker_id
    const workerLocationSnapshot = await db
      .collection("locations")
      .where("worker_id", "==", worker_id)
      .limit(1)
      .get();

    // Check if the worker's location was found
    if (workerLocationSnapshot.empty) {
      return res
        .status(404)
        .json({ message: "Worker location not found in Firestore" });
    }

    // Assuming only one document is returned (matching worker_id)
    const workerLocationData = workerLocationSnapshot.docs[0].data();

    // Extract the GeoPoint object from the worker's location data
    const workerLocationGeoPoint = workerLocationData.location;
    if (
      !workerLocationGeoPoint ||
      !workerLocationGeoPoint.latitude ||
      !workerLocationGeoPoint.longitude
    ) {
      return res
        .status(500)
        .json({ message: "Worker GeoPoint data is missing or incomplete" });
    }

    const workerLongitude = workerLocationGeoPoint.longitude;
    const workerLatitude = workerLocationGeoPoint.latitude;

    // Step 3: Return both user and worker locations as arrays
    return res.status(200).json({
      endPoint: [Number(userLongitude), Number(userLatitude)], // User's location
      startPoint: [workerLongitude, workerLatitude], // Worker's location
    });
  } catch (error) {
    console.error("Error fetching locations:", error.message);
    return res
      .status(500)
      .json({ message: "Error fetching locations", error: error.message });
  }
};

const registerUser = async (req, res) => {
  const { name, email, phoneNumber, referralCode } = req.body;

  try {
    // Step 1: Combine all related operations in a single transaction
    const result = await db.query(
      `
      WITH referrer AS (
        SELECT id FROM users WHERE referral_code = $1
      ), new_user AS (
        INSERT INTO users (name, email, phone_number) 
        VALUES ($2, $3, $4) 
        RETURNING id
      ), insert_referral AS (
        INSERT INTO referrals (referrer_user_id, referred_user_id)
        SELECT referrer.id, new_user.id
        FROM referrer, new_user
        WHERE referrer.id IS NOT NULL
        RETURNING referrer_user_id
      )
      INSERT INTO referral_rewards (user_id, reward_amount, reward_type, status)
      SELECT referrer_user_id, 100, 'cashback', 'earned'
      FROM insert_referral
      RETURNING (SELECT new_user.id FROM new_user) AS user_id;
      `,
      [referralCode, name, email, phoneNumber]
    );

    // Step 2: Generate a unique referral code for the new user
    const newUserId = result.rows[0].user_id;
    const newReferralCode = `CS${newUserId}${crypto
      .randomBytes(2)
      .toString("hex")
      .toUpperCase()}`;

    // Step 3: Update the user's referral code in the database
    await db.query("UPDATE users SET referral_code = $1 WHERE id = $2", [
      newReferralCode,
      newUserId,
    ]);

    // Step 4: Send a success response
    res.status(201).json({
      message: "User registered successfully",
      referralCode: newReferralCode,
    });
  } catch (error) {
    console.error("Error during user registration:", error);
    res.status(500).json({ message: "An error occurred during registration" });
  }
};

const getServices = async () => {
  try {
    const result = await client.query('SELECT * FROM "servicecategories"');
    return result.rows;
  } catch (err) {
    console.error("Error fetching servicecategories:", err);
    throw err;
  }
};

const getIndividualServices = async (req, res) => {
  // Extract serviceObject from the body of the POST request
  const { serviceObject } = req.body;

  try {
    // Query to select specific columns from "services" table where "service_title" matches the provided value
    const result = await client.query(
      'SELECT service_id, service_name, service_urls FROM "services" WHERE "service_title" = $1',
      [serviceObject]
    );

    // Return the rows that match the query
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).send("Internal Server Error");
  }
};

const homeServices = async (req, res) => {
  try {
    const query = `
      SELECT
        service_title,
        array_agg(service_id ORDER BY service_id)      AS service_ids,
        array_agg(service_name ORDER BY service_id)    AS service_names,
        array_agg(service_urls  ORDER BY service_id)    AS service_urls
      FROM services
      GROUP BY service_title
      ORDER BY service_title;
    `;

    const { rows } = await client.query(query);

    // Optionally, if you want each row to have a flatter shape:
    // const services = rows.map(r => ({
    //   title: r.service_title,
    //   ids:   r.service_ids,
    //   names: r.service_names,
    //   urls:  r.service_urls,
    // }));

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching home services:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching home services" });
  }
};

const getUserBookings = async (req, res) => {
  const userId = req.user.id;

  try {
    const query = `
    SELECT 
        u.user_notification_id,
        u.created_at,
        u.service,
        n.notification_id,
        s.payment,
        w.name AS provider,
        ws.profile AS worker_profile
    FROM usernotifications u
    JOIN notifications n ON u.user_notification_id = n.user_notification_id
    JOIN servicecall s ON n.notification_id = s.notification_id
    JOIN workersverified w ON s.worker_id = w.worker_id
    JOIN workerskills ws ON w.worker_id = ws.worker_id
    WHERE u.user_id = $1
    ORDER BY u.created_at DESC
`;

    const { rows } = await client.query(query, [userId]);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user bookings" });
  }
};

const getWorkerProfleDetails = async (req, res) => {
  const workerId = req.worker.id;
  try {
    const query = `
      SELECT 
        w.phone_number, w.name, w.created_at,
        ws.profile, ws.proof, ws.service, ws.subservices
      FROM workerskills ws
      JOIN workersverified w ON ws.worker_id = w.worker_id
      WHERE ws.worker_id = $1
`;

    const { rows } = await client.query(query, [workerId]);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching worker profile:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching worker profile" });
  }
};

const getWorkerReviewDetails = async (req, res) => {
  const workerId = req.worker.id;
  try {
    const query = `
      SELECT 
        f.rating, 
        f.comment, 
        f.created_at, 
        ws.profile, 
        ws.service,
        w.name,
        u.name AS username,
        u.profile AS userImage,
        wl.average_rating
      FROM 
        feedback f
      JOIN 
        workersverified w ON f.worker_id = w.worker_id
      JOIN 
        workerskills ws ON ws.worker_id = w.worker_id
      JOIN 
        "user" u ON u.user_id = f.user_id
      JOIN 
        workerlife wl ON wl.worker_id = w.worker_id
      WHERE 
        f.worker_id = $1
      ORDER BY 
        f.created_at DESC;
    `;

    const { rows } = await client.query(query, [workerId]);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching worker reviews:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching worker reviews" });
  }
};

const getWorkerBookings = async (req, res) => {
  const workerId = req.worker.id;

  try {
    const query = `
    SELECT 
        n.notification_id,
        n.service_booked,
        n.created_at,
        n.total_cost,
        n.complete_status,
        w.name AS provider,
        ws.profile AS worker_profile
    FROM completenotifications n
    JOIN workersverified w ON n.worker_id = w.worker_id
    JOIN workerskills ws ON w.worker_id = ws.worker_id
    WHERE n.worker_id = $1
    ORDER BY n.created_at DESC
`;

    const { rows } = await client.query(query, [workerId]);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user bookings" });
  }
};

const getWorkerOngoingBookings = async (req, res) => {
  console.log("called id")
  const workerId = req.worker.id;

  try {

    const query = `
    SELECT 
        n.notification_id,
        n.service_booked,
        n.created_at,
        n.total_cost,
        w.name AS provider
    FROM accepted n
    JOIN workersverified w ON n.worker_id = w.worker_id
    WHERE n.worker_id = $1
    ORDER BY n.created_at DESC
    `;

    const { rows } = await client.query(query, [workerId]);
    console.log("=roes ",rows[0])
    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user bookings" });
  }
}

const getUserAllBookings = async (req, res) => {
  const userId = req.user.id;

  try {
    const query = `
    SELECT 
        n.notification_id,
        n.service_booked,
        n.created_at,
        n.complete_status,
        n.total_cost,
        w.name AS provider
    FROM completenotifications n
    JOIN "user" w ON n.user_id = w.user_id
    WHERE n.user_id = $1
    ORDER BY n.created_at DESC
    `;

    const { rows } = await client.query(query, [userId]);

    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user bookings" });
  }
};

const getUserOngoingBookings = async (req, res) => {
  const userId = req.user.id;

  try {

    const query = `
    SELECT 
        n.notification_id,
        n.service_booked,
        n.created_at,
        n.total_cost,
        w.name AS provider
    FROM accepted n
    JOIN "user" w ON n.user_id = w.user_id
    WHERE n.user_id = $1
    ORDER BY n.created_at DESC
    `;

    const { rows } = await client.query(query, [userId]);
    console.log("=roes ",rows[0])
    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user bookings" });
  }
}

const workerAuthentication = async (req, res) => {
  const workerId = req.worker.id;
  try {
    if (workerId) {
      return res.status(200).json({ success: true });
    } else {
      return res
        .status(401)
        .json({ success: false, message: "Worker not authenticated" });
    }
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getUserById = async (req, res) => {
  const id = req.user.id;
  try {
    const result = await client.query(
      'SELECT phone_number,name FROM "user" WHERE user_id = $1',
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(`Error fetching user with ID ${id}:`, err);
    throw err;
  }
};

const getWorkerNotifications = async (req, res) => {
  const workerId = req.worker.id;
  const fcmToken = req.query.fcmToken; // Access fcmToken from query parameters

  try {
    const result = await client.query(
      `
      SELECT title, body, encodedId, data, receivedat
      FROM workernotifications
      WHERE worker_id = $1 AND fcm_token = $2
      ORDER BY receivedat DESC
      LIMIT 10;
    `,
      [workerId, fcmToken]
    ); // Pass fcmToken as the second parameter

    const notifications = result.rows;
    res.json(notifications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching notifications" });
  }
};

const getUserNotifications = async (req, res) => {
  const userId = req.user.id;
  const fcmToken = req.query.fcmToken; // Access fcmToken from query parameters

  try {
    const result = await client.query(
      `
      SELECT title, body, encodedId, data, receivedat
      FROM userrecievednotifications
      WHERE user_id = $1 AND fcm_token = $2
      ORDER BY receivedat DESC
      LIMIT 10;
    `,
      [userId, fcmToken]
    ); // Pass fcmToken as the second parameter

    const notifications = result.rows;
    res.json(notifications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching notifications" });
  }
};

const storeUserNotification = async (req, res) => {
  const userId = req.user.id;
  const { fcmToken, notification } = req.body;
  const { title, body, data, receivedAt, userNotificationId } = notification;
  try {
    const result = await client.query(
      "INSERT INTO userrecievednotifications (title, body, data, receivedat, user_id, encodedid, fcm_token) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [
        title,
        body,
        JSON.stringify(data),
        receivedAt,
        userId,
        userNotificationId,
        fcmToken,
      ]
    );
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error storing notification:", err);
    res.status(500).send("Error storing notification");
  }
};

const storeNotification = async (req, res) => {
  const workerId = req.worker.id;
  const { fcmToken, notification } = req.body;
  const { title, body, data, receivedAt, userNotificationId } = notification;
  const { cost } = data;
  try {
    const result = await client.query(
      "INSERT INTO workernotifications (title, body, data, receivedat, worker_id, encodedid, fcm_token) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [title, body, cost, receivedAt, workerId, userNotificationId, fcmToken]
    );
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error storing notification:", err);
    res.status(500).send("Error storing notification");
  }
};

const updateWorkerAction = async (workerId, encodedId, screen) => {
  try {
    console.log("updateWorkerAction called with:", { workerId, encodedId, screen });
    
    const params = JSON.stringify({ encodedId });
    console.log("Constructed params:", params);

    const query = `
      INSERT INTO workeraction (worker_id, screen_name, params)
      VALUES ($1, $2, $3)
      ON CONFLICT (worker_id) DO UPDATE
        SET 
          screen_name = CASE
            WHEN $2 <> '' THEN $2
            WHEN $2 = '' 
              AND workeraction.params::jsonb->>'encodedId' = ($3::jsonb->>'encodedId')
              THEN ''::text
            ELSE workeraction.screen_name
          END,
          params = CASE
            WHEN $2 <> '' THEN $3
            ELSE workeraction.params
          END
      RETURNING *;
    `;
    
    console.log("Executing SQL query:", query);
    const result = await client.query(query, [workerId, screen, params]);
    console.log("Query executed successfully. Result:", result.rows[0]);
    return result.rows[0];
  } catch (error) {
    console.error("Error inserting user action:", error);
  }
};

const createWorkerAction = async (req, res) => {
  const workerId = req.worker.id; // Assuming req.user contains the authenticated user's information
  const { encodedId, screen } = req.body;

  try {
    // Create the params object and convert it to JSON string
    const params = JSON.stringify({ encodedId });

    // Define the SQL query
    const query = `
      INSERT INTO workeraction (worker_id, screen_name, params)
      VALUES ($1, $2, $3)
      ON CONFLICT (worker_id) DO UPDATE
      SET params = $3, screen_name = $2
      RETURNING *;
    `;

    // Execute the query with the provided parameters
    const result = await client.query(query, [workerId, screen, params]);

    // The result should contain the updated or inserted row
    const userAction = result.rows[0];

    // Respond with the user action data
    res.json(userAction);
  } catch (error) {
    console.error("Error inserting user action:", error);
    res.status(500).json({ message: "Error inserting user action" });
  }
};

const createUserAction = async (req, res) => {
  const userId = req.user.id; // Assuming req.user contains the authenticated user's information
  const {
    encodedId,
    screen,
    serviceBooked,
    area,
    city,
    alternateName,
    alternatePhoneNumber,
    pincode,
    location,
    discount,
    tipAmount,
    offer
  } = req.body;

  // console.log("User action creation initiated", req.body);
  // console.log("Location is came or not", location);

  try {
    // Define the SQL query to get the existing user action
    const query = `
      SELECT * FROM useraction
      WHERE user_id = $1;
    `;

    // Execute the query to get the existing user action
    const result = await client.query(query, [userId]);
    const existingUserAction = result.rows[0];

    // Determine whether the additional fields are present
    const hasAdditionalFields =
      area || city || alternateName || alternatePhoneNumber || pincode;

    if (existingUserAction) {
      // If the user action exists, update the track array
      let updatedTrack = existingUserAction.track;

      if (screen === "") {
        // Remove the object with the matching encodedId if screen is empty
        updatedTrack = updatedTrack.filter(
          (item) => item.encodedId !== encodedId
        );
      } else {
        // Update or add the object with the new screen, encodedId, and additional fields
        updatedTrack = updatedTrack.filter(
          (item) => item.encodedId !== encodedId
        );

        const newAction = {
          screen,
          encodedId,
          serviceBooked,
        };
        // If additional fields are present, include them in the update
        if (hasAdditionalFields) {
          newAction.area = area;
          newAction.city = city;
          newAction.alternateName = alternateName;
          newAction.alternatePhoneNumber = alternatePhoneNumber;
          newAction.pincode = pincode;
          newAction.location = location;
          newAction.discount = discount;
          newAction.tipAmount = tipAmount;
          newAction.offer = offer;
        }
        // console.log("new action anta ", newAction);
        // console.log("new action anta ra location undha", newAction.location);

        updatedTrack.push(newAction);
      }

      // Update the user action with the new track array
      const updateQuery = `
        UPDATE useraction
        SET track = $1
        WHERE user_id = $2
        RETURNING *;
      `;
      const updateResult = await client.query(updateQuery, [
        JSON.stringify(updatedTrack),
        userId,
      ]);
      const updatedTrackScreen = updateResult.rows[0];

      // Respond with the updated user action data
      res.json(updatedTrackScreen);
    } else {
      // If the user action does not exist, create a new one
      let newTrack = [];

      if (screen) {
        const newAction = {
          screen,
          encodedId,
          serviceBooked,
        };

        // Include additional fields if they are present
        if (hasAdditionalFields) {
          newAction.area = area;
          newAction.city = city;
          newAction.alternateName = alternateName;
          newAction.alternatePhoneNumber = alternatePhoneNumber;
          newAction.pincode = pincode;
          newAction.location = location;
          newAction.discount = discount;
          newAction.tipAmount = tipAmount;
          newAction.offer = offer;
        }

        newTrack = [newAction];
      }

      const insertQuery = `
        INSERT INTO useraction (user_id, track)
        VALUES ($1, $2)
        RETURNING *;
      `;
      const insertResult = await client.query(insertQuery, [
        userId,
        JSON.stringify(newTrack),
      ]);
      const updatedTrackScreen = insertResult.rows[0];

      // Respond with the new user action data
      res.json(updatedTrackScreen);
    }
  } catch (error) {
    console.error("Error inserting or updating user action:", error);
    res
      .status(500)
      .json({ message: "Error inserting or updating user action" });
  }
};

const userActionRemove = async (req, res) => {
  const userId = req.user.id; // Assuming req.user contains the authenticated user's information
  const { screen, encodedId,offer } = req.body;

  console.log("offer applied",offer)

  // console.log("Removing user action");

  try {
    if(offer){
      const offerCodeValue = offer.offer_code
      console.log("offers applied changes",offerCodeValue)
      const queryText = `
        UPDATE "user" AS u
        SET offers_used = (
          SELECT jsonb_agg(
            CASE
              WHEN elem->>'offer_code' = $1
                THEN elem || '{"status":"pending"}'
              ELSE elem
            END
          )
          FROM jsonb_array_elements(u.offers_used) elem
        )
        WHERE u.user_id = $2
      `;

      const values = [offerCodeValue, userId];

      await client.query(queryText, values);
    }

    // Step 1: Get the track field directly (no need to select the entire row)
    const query = `
      SELECT track FROM useraction
      WHERE user_id = $1;
    `;

    // Execute the query to get the current user's track data
    const result = await client.query(query, [userId]);
    const existingTrack = result.rows[0]?.track;

    if (!existingTrack) {
      return res.status(404).json({ message: "User action not found" });
    }

    // Step 2: Filter out the object with the matching encodedId
    const updatedTrack = existingTrack.filter(
      (item) => item.encodedId !== encodedId
    );

    if (updatedTrack.length === existingTrack.length) {
      return res.status(404).json({ message: "No matching encodedId found" });
    }

    // Step 3: Update the track array in the database
    const updateQuery = `
      UPDATE useraction
      SET track = $1
      WHERE user_id = $2
      RETURNING *;
    `;
    const updateResult = await client.query(updateQuery, [
      JSON.stringify(updatedTrack),
      userId,
    ]);

    // Step 4: Respond with the updated user action
    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error("Error removing user action:", error);
    res.status(500).json({ message: "Error removing user action" });
  }
};

const getWorkerTrackRoute = async (req, res) => {
  const id = req.worker.id;
  try {
    // Query to select route and parameters based on user_id
    const query = `
    SELECT wv.name, wv.no_due, wa.screen_name, wa.params
    FROM workeraction wa
    JOIN workersverified wv ON wa.worker_id = wv.worker_id
    WHERE wa.worker_id = $1
  `;
  
    const result = await client.query(query, [id]);

    if (result.rows.length > 0) {
      const route = result.rows[0].screen_name;
      const parameter = result.rows[0].params;
      const name = result.rows[0].name;
      const no_due = result.rows[0].no_due
      res.status(200).json({ route, parameter, name, no_due });
    } else {
      res
        .status(200)
        .json({ error: "No action found for the specified worker_id" });
    }
  } catch (err) {
    console.error(`Error fetching user with ID ${id}:`, err);
    throw err;
  }
};

const translateText = async (req, res) => {
  const { text, fromLang, toLang } = req.body;

  console.log(req.body);

  if (!text || !fromLang || !toLang) {
    return res
      .status(400)
      .json({ error: 'Missing required fields: text, fromLang, toLang' });
  }

  try {
    // Construct the API URL with query parameters
    const url = `${endpoint}/translate?api-version=${apiVersion}&from=${fromLang}&to=${toLang}`;

    // Set up headers for authentication and content type
    const headers = {
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Ocp-Apim-Subscription-Region': region,
      'Content-Type': 'application/json',
      'X-ClientTraceId': uuidv4().toString(),
    };

    // Request body must be an array of objects with a "Text" property
    const body = [{ Text: text }];

    // Send POST request to Azure Translator API
    const response = await axios.post(url, body, { headers });

    // Extract the translated text from response
    const translatedText =
      response.data[0]?.translations[0]?.text || 'Translation not available';

    res.json({ translatedText });
  } catch (error) {
    console.error('Error in translation:', error.response?.data || error.message);
    res.status(500).json({ error: 'Translation failed' });
  }
};

const getUserTrackRoute = async (req, res) => {
  const id = req.user.id;
  try {
    // Query using a JOIN to fetch the user's name and track in one go
    const query = `
      SELECT u.name, u.profile, ua.track
      FROM "user" u
      LEFT JOIN useraction ua ON u.user_id = ua.user_id
      WHERE u.user_id = $1;
    `;

    const result = await client.query(query, [id]);

    if (result.rows.length > 0) {
      const { name, track, profile } = result.rows[0];

      if (track) {
        // If track exists, return both the track and user name
        res.status(200).json({ track, user: name,profile });
      } else {
        // If no track, return only the user name
        res.status(203).json({ user: name,profile });
      }
    } else {
      // If no user found, return a 404 error
      res.status(404).json({ message: "User not found" });
    }
  } catch (err) {
    console.error(`Error fetching user with ID ${id}:`, err);
    res.status(500).json({ message: "Error fetching user data" });
  }
};

const loginStatus = async (req, res) => {
  const id = req.user.id;
  try {
    const result = await client.query(
      'SELECT * FROM "user" WHERE user_id = $1',
      [id]
    );

    if (result.rows.length > 0) {
      res.status(200).json(result.rows[0]);
    } else {
      res.status(401).json({ message: "Unauthorized" });
    }
  } catch (err) {
    console.error(`Error fetching user with ID ${id}:`, err);
    res.status(500).json({ message: "Internal server error" });
  }
};

const getUserByPhoneNumber = async (phone_number) => {
  try {
    const query = 'SELECT user_id, name, phone_number FROM "user" WHERE phone_number = $1';
    const result = await client.query(query, [phone_number]);

    return result.rows.length ? result.rows[0] : null;
  } catch (error) {
    console.error("Error fetching user by phone number:", error);
    throw new Error("Database query failed");
  }
};

const login = async (req, res) => {
  const { phone_number } = req.body;
  console.log("phonenumber",phone_number)
  if (!phone_number) {
    return res.status(400).json({ message: "Phone number is required" });
  }

  try {
    // Find the user by phone number
    const user = await getUserByPhoneNumber(phone_number);
    console.log("user there are not ",user)
    if (user) {
      // Generate a token for the user
      const token = generateToken(user);
      // Set token as an HTTP-only cookie (for web) or return it in the JSON response
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
      });
      return res.status(200).json({ token });
    } else {
      console.log("user there are not there 205",)
      // Use status 205 (or an alternative status) to indicate that the user does not exist
      return res.status(205).json({ message: "User not found" });
    }
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const getAllServices = async () => {
  try {
    const result = await client.query(`
      SELECT
        main_service_id, 
        service_category, 
        service_tag, 
        service_details
      FROM allservices
    `);
    return result.rows;
  } catch (error) {
    console.error("Error fetching all services:", error);
    throw error;
  }
};

const getServicesBySearch = async (req, res) => {
  // Get the search query in lowercase and trim any extra spaces
  const searchQuery = req.query.search ? req.query.search.toLowerCase().trim() : "";
  
  try {
    const allServices = await getAllServices();

    // Split the search query into keywords
    const searchKeywords = searchQuery.split(" ").filter(Boolean);

    // Define a function to calculate a score for each service based on different match criteria
    const calculateScore = (service) => {
      let score = 0;
      // Define the fields to check
      const fields = ["service_tag", "service_category", "service_name"];

      fields.forEach((field) => {
        const value = service[field];
        if (value) {
          const valueLower = value.toLowerCase();

          // Prioritize if the field starts with the full search query
          if (valueLower.startsWith(searchQuery)) {
            score += 3;
          } else if (valueLower.includes(searchQuery)) {
            score += 2;
          }

          // Check each keyword separately
          searchKeywords.forEach((keyword) => {
            if (valueLower.startsWith(keyword)) {
              score += 2;
            } else if (valueLower.includes(keyword)) {
              score += 1;
            }
          });
        }
      });

      return score;
    };

    // Map services to include a computed score
    const scoredServices = allServices.map((service) => ({
      ...service,
      score: calculateScore(service)
    }));

    // Filter out services with no matches (score === 0)
    const filteredServices = scoredServices.filter(service => service.score > 0);

    // Sort the results by score (highest score first)
    filteredServices.sort((a, b) => b.score - a.score);

    res.json(filteredServices);
  } catch (error) {
    console.error("Error fetching services:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const storeWorkerLocation = async (req, res) => {
  const { longitude, latitude, workerId } = req.body;

  try {
    const query = `
      INSERT INTO workerLocation (longitude, latitude, worker_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (worker_id)
      DO UPDATE SET longitude = EXCLUDED.longitude, latitude = EXCLUDED.latitude
    `;
    await client.query(query, [longitude, latitude, workerId]);

    res.status(200).json({ message: "User location stored successfully" });
  } catch (error) {
    console.error("Error storing user location:", error);
    res.status(500).json({ error: "Failed to store user location" });
  }
};

const updateWorkerLocation = async (req, res) => {
  const workerId = req.worker.id;
  const { longitude, latitude } = req.body;

  try {
    const query = `
      INSERT INTO workerLocation (longitude, latitude, worker_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (worker_id)
      DO UPDATE SET longitude = EXCLUDED.longitude, latitude = EXCLUDED.latitude
    `;
    await client.query(query, [longitude, latitude, workerId]);

    res.status(200).json({ message: "User location stored successfully" });
  } catch (error) {
    console.error("Error storing user location:", error);
    res.status(500).json({ error: "Failed to store user location" });
  }
};

const storeUserFcmToken = async (req, res) => {
  const { fcmToken } = req.body;
  const userId = req.user.id;

  try {
    // Single query using CTE:
    // 1) Delete any row with the same fcm_token (to avoid duplicates across users)
    // 2) Insert new row with (user_id, fcm_token).
    // 3) ON CONFLICT DO NOTHING if the same row (user_id + fcm_token) already exists.
    // 4) Return the newly inserted row (if any).
    const upsertQuery = `
      WITH delete_matched AS (
        DELETE FROM userfcm
        WHERE fcm_token = $2
      )
      INSERT INTO userfcm (user_id, fcm_token)
      VALUES ($1, $2)
      ON CONFLICT (user_id, fcm_token)
      DO NOTHING
      RETURNING user_id, fcm_token;
    `;

    const result = await client.query(upsertQuery, [userId, fcmToken]);

    if (result.rowCount > 0) {
      // Successfully inserted a new row
      return res.status(200).json({ message: "FCM token stored successfully" });
    } else {
      // The row already existed for this user, or ON CONFLICT prevented insert
      return res.status(200).json({ message: "FCM token already exists for this user" });
    }
  } catch (error) {
    console.error("Error storing FCM token:", error);
    return res.status(500).json({ error: "Failed to store FCM token" });
  }
};

const storeFcmToken = async (req, res) => {
  const { fcmToken } = req.body;
  const workerId = req.worker.id;

  try {
    // Single query using CTE:
    // 1) Delete any row with the same fcm_token (to avoid duplicates across workers)
    // 2) Insert new row with (worker_id, fcm_token).
    // 3) ON CONFLICT DO NOTHING if the same row (worker_id + fcm_token) already exists.
    // 4) Return the newly inserted row (if any).
    const upsertQuery = `
      WITH delete_matched AS (
        DELETE FROM fcm
        WHERE fcm_token = $2
      )
      INSERT INTO fcm (worker_id, fcm_token)
      VALUES ($1, $2)
      ON CONFLICT (worker_id, fcm_token)
      DO NOTHING
      RETURNING worker_id, fcm_token;
    `;

    const result = await client.query(upsertQuery, [workerId, fcmToken]);

    if (result.rowCount > 0) {
      // Successfully inserted a new row
      res.status(200).json({ message: "FCM token stored successfully" });
    } else {
      // The row already existed for this worker, or ON CONFLICT prevented insert
      res.status(200).json({ message: "FCM token already exists for this worker" });
    }
  } catch (error) {
    console.error("Error storing FCM token:", error);
    res.status(500).json({ error: "Failed to store FCM token" });
  }
};

const initiateCall = async (req, res) => {
  try {
    const { from, to, scheduled, timezone_id, scheduled_datetime } = req.body;

    console.log("Request Body:", req.body);

    if (!from || !to) {
      return res.status(400).json({ error: 'Both "from" and "to" numbers are required.' });
    }

    // Build the payload.
    // Note: Set dial to "agent" so that the system expects the from person to dial the IVR number manually.
    const payload = {
      api_id: "APIMQSArLJl140228",
      api_password: "W2tbf56h",
      ivr_number: "1732351343", // Replace with your active IVR number.
      dial: "agent",          // "agent" means the system will not automatically call the from number.
      receiver_number: to,     // The number to connect when the IVR is dialed.
      agent_number: from,      // The from person's number.
      scheduled: scheduled || 0,
      timezone_id: timezone_id || "",
      scheduled_datetime: scheduled_datetime || ""
    };

    // Make the API call.
    const apiResponse = await axios.post('https://www.bulksmsplans.com/api/ivr/makeACall', payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log("API Response:", apiResponse.data);
    const { code, message, data } = apiResponse.data;

    if (code !== 200) {
      return res.status(500).json({ error: message, details: data });
    }

    // Construct an instructional message.
    const instruction = `Call initiated successfully. The IVR number ${payload.ivr_number} is now active. Please call this number from your phone to connect with ${to}.`;

    return res.json({
      message: instruction,
      callMaskingNumber: payload.ivr_number,
      details: data
    });
  } catch (err) {
    console.error("Error in initiateCall:", err.message);
    return res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};

const getCurrentTimestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0"); // Months are zero-indexed
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const intervalSetForNotifications = new Set();

// Fetch location details for navigation ***
const getLocationDetails = async (req, res) => {
  try {
    const { notification_id } = req.query;

    if (!notification_id) {
      return res.status(400).json({ error: "Missing notification_id" });
    }

    const locationDetails = await fetchLocationDetails(notification_id);
    res.json(locationDetails);

    // Start the interval to update the navigation status to timeup after 4 minutes
    if (notification_id && !intervalSetForNotifications.has(notification_id)) {
      intervalSetForNotifications.add(notification_id);
      setTimeout(() => updateNavigationStatus(notification_id), 4 * 60 * 1000);
    }
  } catch (err) {
    console.error("Error fetching location details:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// Function to fetch location details from the database
const fetchLocationDetails = async (notificationId) => {
  console.log(notificationId)
  try {
    // Query to get the start and endpoint details using a JOIN between accepted and workerlocation tables
    const query = `
      SELECT 
        a.worker_id,
        a.longitude AS end_longitude, 
        a.latitude AS end_latitude
      FROM accepted a
      WHERE a.notification_id = $1;
    `;

    const result = await client.query(query, [notificationId]);

    if (result.rows.length === 0) {
      throw new Error("Notification or Worker location not found");
    }

    const { end_longitude, end_latitude, worker_id } = result.rows[0];

    const location = await getWorkerLocation(worker_id);
    let start_latitude = null;
    let start_longitude = null;
    location.forEach((locationData) => {
      const {
        location: { _latitude: latitude, _longitude: longitude },
      } = locationData;
      start_longitude = longitude;
      start_latitude = latitude;
    });

    // console.log("worker", location);

    // Return the start and end points
    return {
      startPoint: [start_latitude, start_longitude],
      endPoint: [end_latitude, end_longitude],
    };
  } catch (err) {
    console.error("Error fetching location details:", err);
    throw err;
  }
};

const userCoupons = async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await client.query(
      `
      SELECT 
        u.service_completed, 
        COALESCE(rr.coupons, NULL) AS coupons
      FROM 
        public."user" u  -- "user" is a reserved keyword, so it's wrapped in double quotes
      LEFT JOIN 
        referral_rewards rr
      ON 
        u."referral_Code" = rr.referral_code  -- Corrected column reference
      WHERE 
        u.user_id = $1
      `,
      [userId]
    );

    if (result.rows.length > 0) {
      const { service_completed, coupons } = result.rows[0];
      res.json({ service_completed, coupons: coupons || null });
    } else {
      res.status(404).json({ message: "User not found or no data available" });
    }
  } catch (error) {
    console.error("Error fetching user coupons:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const userProfileUpdate = async (req, res) => {
    const user_id = req.user.id;
    const {  profileImage } = req.body;

    // Check if both parameters are provided
    if (!user_id || !profileImage) {
        return res.status(400).json({ error: "user_id and profileImage are required." });
    }

    try {
        // Update the user's profile image
        const query = `
            UPDATE "user"
            SET profile = $1
            WHERE user_id = $2
            RETURNING *;
        `;
        
        const values = [profileImage, user_id];

        const result = await client.query(query, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        res.status(200).json({
            message: "Profile updated successfully.",
            updatedUser: result.rows[0]
        });
    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ error: "Internal server error." });
    }
};

const workerProfileUpdate = async (req, res) => {
  const worker_id = req.worker.id;
  console.log("called")
  const {  profileImage } = req.body;

  // Check if both parameters are provided
  if (!worker_id || !profileImage) {
      return res.status(400).json({ error: "user_id and profileImage are required." });
  }

  try {
      // Update the user's profile image
      const query = `
      UPDATE workerskills
      SET profile = $1
      WHERE worker_id = $2
      RETURNING *;
  `;
  
      
      const values = [profileImage, worker_id];

      const result = await client.query(query, values);

      if (result.rowCount === 0) {
          return res.status(404).json({ error: "User not found." });
      }

      res.status(200).json({
          message: "Profile updated successfully.",
          updatedUser: result.rows[0]
      });
  } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ error: "Internal server error." });
  }
};

// Check cancellation status
const checkCancellationStatus = async (req, res) => {
  try {
    const { notification_id } = req.query;
    const result = await client.query(
      "SELECT navigation_status FROM accepted WHERE notification_id = $1",
      [notification_id]
    );
    if (result.rows.length > 0) {
      const { navigation_status } = result.rows[0];
      res.json({ navigation_status });
    } else {
      res.status(404).json({ error: "Notification not found" });
    }
  } catch (error) {
    console.error("Error checking cancellation status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ***
const TimeStart = async (notification_id) => {
  try {
    // Query to insert into servicecall and get the worker_id in one step,
    // while also inserting the payment value from accepted.total_cost
    const result = await client.query(
      `
      INSERT INTO servicecall (notification_id, start_time, worker_id, payment)
      SELECT $1, $2, worker_id, total_cost
      FROM accepted
      WHERE notification_id = $1
      RETURNING start_time
      `,
      [notification_id, new Date()]
    );

    if (result.rows.length > 0) {
      return result.rows[0].start_time;
    } else {
      return "Insertion failed";
    }
  } catch (error) {
    console.error("Error in TimeStart:", error);
    return "Error occurred";
  }
};

const updateUserNavigationStatus = async (notification_id) => {
  try {
    await client.query(
      `UPDATE accepted SET user_navigation_cancel_status = 'timeup' WHERE notification_id = $1`,
      [notification_id]
    );
  } catch (error) {
    console.error("Error updating user navigation status to timeup:", error);
  }
};

// Update navigation status to timeup after 4 minutes
const updateNavigationStatus = async (notification_id) => {
  try {
    const result = await client.query(
      "UPDATE accepted SET navigation_status = 'timeup' WHERE notification_id = $1",
      [notification_id]
    );
  } catch (error) {
    console.error("Error updating navigation status to timeup:", error);
    throw error; // Throw the error to handle it in calling functions
  }
};

const userCancellationStatus = async (req, res) => {
  const { notification_id } = req.query;

  if (!notification_id) {
    return res.status(400).json({ error: "Notification ID is required" });
  }

  try {
    // Using SELECT 1 to only check if a row exists without retrieving unnecessary data
    const result = await client.query(
      "SELECT 1 FROM accepted WHERE notification_id = $1",
      [notification_id]
    );

    if (result.rows.length > 0) {
      // If the row is present, return HTTP 200
      return res.status(200).json({ message: "Row found" });
    } else {
      // If no row is found, return HTTP 205 with a cancellation message
      return res.status(205).json({ message: "User cancelled" });
    }
  } catch (error) {
    console.error("Error checking cancellation status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Controller function to get the cancellation status
const workerCancellationStatus = async (req, res) => {
  const { notification_id } = req.query;

  if (!notification_id) {
    return res.status(400).json({ error: "notification_id is required" });
  }

  try {
    const result = await client.query(
      "SELECT navigation_status FROM accepted WHERE notification_id = $1",
      [notification_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    const notificationStatus = result.rows[0].navigation_status;
    res.json(notificationStatus);
  } catch (error) {
    console.error("Error fetching cancellation status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Controller function to get user address details
const getUserAddressDetails = async (req, res) => {
  const { notification_id } = req.query;

  try {
    // Query to fetch user address details by joining Notifications and UserNotifications tables
    const query = `
      SELECT 
        N.messages,
        UN.city, 
        UN.area, 
        UN.pincode, 
        UN.alternate_phone_number, 
        UN.alternate_name,
        UN.service_booked,
        U.name,
        U.profile
      FROM accepted N
      JOIN UserNotifications UN ON N.user_notification_id = UN.user_notification_id
      JOIN "user" U ON UN.user_id = U.user_id
      WHERE N.notification_id = $1
    `;

    // Execute the JOIN query
    const result = await client.query(query, [notification_id]);

    // Check if data was found
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Notification or user address details not found" });
    }

    // Destructure and return the address details
    const {
      city,
      area,
      pincode,
      alternate_phone_number,
      alternate_name,
      service_booked,
    } = result.rows[0];
    // console.log(result.rows[0])

    res.json({
      city,
      area,
      pincode,
      alternate_phone_number,
      alternate_name,
      service_booked,
    });
  } catch (error) {
    console.error("Error fetching user address details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const rejectRequest = async (req, res) => {
  const { user_notification_id } = req.body;
  const worker_id = req.worker.id;

  try {
    const result = await client.query(
      "UPDATE notifications SET status = $1 WHERE user_notification_id = $2 AND worker_id = $3 RETURNING *",
      ["reject", user_notification_id, worker_id]
    );

    if (result.rowCount === 0) {
      res
        .status(404)
        .json({ message: "Notification not found or worker mismatch" });
    } else {
      res.status(200).json({
        message: "Status updated to reject",
        notification: result.rows[0],
      });
    }
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const createUserBackgroundAction = async (
  userId,
  encodedId,
  screen,
  serviceBooked,
  userNotificationEncodedId = null
) => {
  // console.log('Service Booked:', screen,encodedId,serviceBooked);

  try {
    // Prepare the new action object if 'screen' is provided
    const newAction = screen
      ? {
          screen,
          encodedId,
          serviceBooked,
        }
      : null;

    // Convert newAction to JSON string if it exists
    const newActionJson = newAction ? JSON.stringify(newAction) : null;

    // Prepare the initial track array for insertion
    const initialTrack = newAction
      ? JSON.stringify([newAction])
      : JSON.stringify([]);

    // Define the UPSERT query with explicit casting for $4 and $5
    const upsertQuery = `
      INSERT INTO useraction (user_id, track)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (user_id) DO UPDATE
      SET track = (
        SELECT 
          COALESCE(jsonb_agg(item), '[]'::jsonb)
        FROM 
          jsonb_array_elements(useraction.track) AS item
        WHERE 
          item->>'encodedId' <> $3
          AND ($4::text IS NULL OR item->>'encodedId' <> $4::text)
      ) || (
        CASE 
          WHEN $5::jsonb IS NOT NULL THEN $6::jsonb 
          ELSE '[]'::jsonb 
        END
      )
      RETURNING *;
    `;

    // Parameters for the query
    const params = [
      userId, // $1: user_id
      initialTrack, // $2: initial track array (JSONB)
      encodedId, // $3: encodedId to remove
      userNotificationEncodedId, // $4: userNotificationEncodedId to remove (can be null)
      newActionJson, // $5: new action JSON (if screen is provided)
      newActionJson ? `[${newActionJson}]` : "[]", // $6: new action as JSONB array or empty array
    ];

    // Execute the UPSERT query
    const result = await client.query(upsertQuery, params);

    // The result will contain the inserted or updated row
    const updatedTrackScreen = result.rows[0];

    // Return the updated user action data
    return updatedTrackScreen;
  } catch (error) {
    console.error("Error inserting or updating user background action:", error);
    throw error; // Re-throw the error after logging
  }
};

const workCompletionCancel = async (req, res) => {
  const { notification_id } = req.body;
  try {
    if (notification_id) {
      const updateResult = await client.query(
        "UPDATE accepted SET complete_status = $1 WHERE notification_id = $2 RETURNING *",
        ["cancel", notification_id]
      );
      if (updateResult.rowCount > 0) {
        res.status(200).json({
          message: "Status updated to accept",
        });
      }
    } else {
      res.status(400).json({ message: "notification_id not there" });
    }
  } catch (error) {}
};

const acceptRequest = async (req, res) => {
  const { user_notification_id } = req.body;
  const worker_id = req.worker.id;

  try {
    // Start a transaction
    await client.query("BEGIN");

    // Combined CTE to perform multiple operations

    //   const combinedQuery = `
    //   WITH check_accept AS (
    //     SELECT notification_id
    //     FROM accepted
    //     WHERE user_notification_id = $1
    //     FOR UPDATE
    //   ),
    //   get_notification AS (
    //     SELECT
    //       n.cancel_status,
    //       n.user_id,
    //       n.notification_id,
    //       n.service_booked,
    //       n.longitude,
    //       n.latitude
    //     FROM notifications n
    //     WHERE n.user_notification_id = $1
    //     FOR UPDATE
    //   ),
    //   insert_accept AS (
    //     INSERT INTO accepted
    //       (user_notification_id, worker_id, notification_id, status, user_id, service_booked, pin, longitude, latitude, time)
    //     SELECT
    //       $1,
    //       $2,
    //       gn.notification_id,
    //       'accept',
    //       gn.user_id,
    //       CASE
    //         WHEN jsonb_typeof(gn.service_booked::jsonb) IS NOT NULL THEN gn.service_booked::jsonb
    //         ELSE to_jsonb(gn.service_booked)
    //       END,
    //       FLOOR(RANDOM() * 9000) + 1000,
    //       gn.longitude::numeric,
    //       gn.latitude::numeric,
    //       jsonb_build_object(
    //         'accept', to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    //         'arrived', null,
    //         'workCompleted', null,
    //         'paymentCompleted', null
    //       )
    //     FROM get_notification gn
    //     RETURNING notification_id
    //   ),
    //   delete_notification AS (
    //     DELETE FROM notifications
    //     WHERE user_notification_id = $1
    //     RETURNING 1
    //   )
    //   SELECT
    //     ia.notification_id AS inserted_notification_id,
    //     ca1.notification_id AS existing_notification_id,
    //     gn.cancel_status,
    //     gn.user_id,
    //     gn.service_booked,
    //     gn.longitude,
    //     gn.latitude
    //   FROM check_accept ca1
    //   RIGHT JOIN get_notification gn ON TRUE
    //   LEFT JOIN insert_accept ia ON TRUE
    //   LEFT JOIN delete_notification dn ON TRUE
    // `;

    const combinedQuery = `
      WITH check_accept AS (
        SELECT notification_id 
        FROM accepted 
        WHERE user_notification_id = $1 
        FOR UPDATE
      ),
      get_notification AS (
        SELECT 
          n.cancel_status, 
          n.user_id, 
          n.notification_id, 
          n.service_booked, 
          n.longitude, 
          n.latitude, 
          n.discount, 
          n.total_cost,
          n.tip_amount
        FROM notifications n
        WHERE n.user_notification_id = $1 
        FOR UPDATE
      ),
      insert_accept AS (
        INSERT INTO accepted 
          (user_notification_id, worker_id, notification_id, status, user_id, service_booked, service_status, pin, longitude, latitude, time, discount, total_cost, tip_amount)
        SELECT 
          $1, 
          $2, 
          gn.notification_id, 
          'accept', 
          gn.user_id, 
          gn.service_booked::jsonb,
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'accept', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'arrived', null,
                'workCompleted', null,
                'serviceName', service->>'serviceName',
                'Quantity' , service->>'quantity'
              )
            )
            FROM jsonb_array_elements(gn.service_booked) AS service
          ),
          FLOOR(RANDOM() * 9000) + 1000, 
          gn.longitude::numeric, 
          gn.latitude::numeric,
          jsonb_build_object(
            'accept', to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
            'arrived', null,
            'workCompleted', null,
            'paymentCompleted', null
          ),
          gn.discount,
          gn.total_cost,
          gn.tip_amount
        FROM get_notification gn
        RETURNING notification_id
      ),
      delete_notification AS (
        DELETE FROM notifications 
        WHERE user_notification_id = $1 
        RETURNING 1
      )
      SELECT 
        ia.notification_id AS inserted_notification_id,
        ca1.notification_id AS existing_notification_id,
        gn.cancel_status,
        gn.user_id,
        gn.service_booked,
        gn.longitude,
        gn.latitude
      FROM check_accept ca1
      RIGHT JOIN get_notification gn ON TRUE
      LEFT JOIN insert_accept ia ON TRUE
      LEFT JOIN delete_notification dn ON TRUE;
  `;

    const combinedResult = await client.query(combinedQuery, [
      user_notification_id,
      worker_id,
    ]);

    // Extract the first row (since the query should return only one row)
    const row = combinedResult.rows[0];

    // **Check if someone already accepted the request**
    if (row.existing_notification_id) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Someone already accepted the request." });
    }

    // **Check if notification exists**
    if (!row.cancel_status && !row.user_id && !row.notification_id) {
      // If 'get_notification' didn't find any row, these fields would be undefined
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Notification not found." });
    }
    if (row.cancel_status === "cancel") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Cannot accept request; it has been canceled." });
    }

    const insertedNotificationId = row.inserted_notification_id;
    const fcmResult = await client.query(
      `SELECT uf.fcm_token
       FROM userfcm uf
       WHERE uf.user_id = $1`,
      [row.user_id]
    );

    const fcmTokens = fcmResult.rows
      .map((r) => r.fcm_token)
      .filter((token) => token);
    await client.query("COMMIT");
    if (fcmTokens.length > 0) {
      const multicastMessage = {
        tokens: fcmTokens,
        notification: {
          title: "Click Solver",
          body: `Commander has accepted your request; he will be there within 5 minutes.`,
        },
        data: {
          notification_id: insertedNotificationId.toString(),
          screen: "UserNavigation",
        },
      };
      const response = await getMessaging().sendEachForMulticast(
        multicastMessage
      );
      response.responses.forEach((resp, index) => {
        if (resp.success) {
        } else {
          console.error(
            `Error sending message to token ${fcmTokens[index]}:`,
            resp.error
          );
        }
      });
    } else {
      console.error("No FCM tokens to send the message to.");
    }
    const userNotificationEncodedId = Buffer.from(
      user_notification_id.toString()
    ).toString("base64");
    const encodedId = Buffer.from(insertedNotificationId.toString()).toString(
      "base64"
    );
    const screen = "UserNavigation";
    let parsedServiceBooked;
    if (typeof row.service_booked === "string") {
      try {
        parsedServiceBooked = JSON.parse(row.service_booked);
      } catch (parseError) {
        console.error("Error parsing service_booked JSON:", parseError);
        parsedServiceBooked = row.service_booked;
      }
    } else {
      parsedServiceBooked = row.service_booked;
    }
    const backgroundActionResult = await createUserBackgroundAction(
      row.user_id,
      encodedId,
      screen,
      parsedServiceBooked,
      userNotificationEncodedId
    );
    await updateWorkerAction(worker_id, encodedId, screen);
    res.status(200).json({
      message: "Status updated to accept",
      notificationId: insertedNotificationId,
      backgroundAction: backgroundActionResult,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Error during ROLLBACK:", rollbackError);
    }
    console.error("Error updating status:", error.message);
    console.error("Error Stack:", error.stack);
    res.status(500).json({ message: "Internal server error" });
  }
};

// const userNavigationCancel = async (req, res) => {
//   const { notification_id, user_id, offer_code } = req.body;

//   try {
//     await client.query("BEGIN");
//     console.log("Transaction started for notification_id:", notification_id);

//     // Combined query: update accepted, insert into completenotifications, and update user.
//     const combinedQuery = await client.query(
//       `
//       WITH verification AS (
//         SELECT verification_status, worker_id, service_booked
//         FROM accepted 
//         WHERE notification_id = $1
//       ),
//       updated AS (
//         UPDATE accepted
//         SET user_navigation_cancel_status = 'usercanceled'
//         WHERE notification_id = $1 
//           AND (SELECT NOT verification_status FROM verification)
//         RETURNING *
//       ),
//       inserted AS (
//         INSERT INTO completenotifications (
//           accepted_id, notification_id, user_id, user_notification_id,
//           longitude, latitude, created_at, worker_id, complete_status,
//           service_booked, time, discount, total_cost, tip_amount
//         )
//         SELECT 
//           accepted_id, notification_id, user_id, user_notification_id,
//           longitude, latitude, created_at, worker_id, 'usercanceled',
//           service_booked, time, discount, total_cost, tip_amount
//         FROM updated
//         RETURNING worker_id, notification_id
//       ),
//       user_updated AS (
//         UPDATE "user" AS u
//         SET offers_used = (
//           SELECT jsonb_agg(
//             CASE
//               WHEN elem->>'offer_code' = $2 THEN elem || '{"status": "pending"}'
//               ELSE elem
//             END
//           )
//           FROM jsonb_array_elements(u.offers_used) AS elem
//         )
//         WHERE u.user_id = $3
//           AND EXISTS (
//             SELECT 1 
//             FROM updated a
//             WHERE a.user_id = $3
//               AND a.coupons_applied IS NOT NULL
//               AND EXISTS (
//                 SELECT 1
//                 FROM jsonb_array_elements(a.coupons_applied) AS ac
//                 WHERE ac->>'offer_code' = $2
//               )
//           )
//         RETURNING u.user_id
//       )
//       SELECT 
//         v.verification_status AS verified,
//         COALESCE(i.worker_id, v.worker_id) AS worker_id, 
//         service_booked,
//         f.fcm_token
//       FROM verification v
//       LEFT JOIN inserted i ON true
//       LEFT JOIN workersverified w ON w.worker_id = COALESCE(i.worker_id, v.worker_id)
//       LEFT JOIN fcm f ON f.worker_id = w.worker_id;
//       `,
//       [notification_id, offer_code, user_id]
//     );

//     // Check if insertion took place.
//     if (combinedQuery.rows.length === 0) {
//       await client.query("ROLLBACK");
//       return res.status(404).json({ error: "Notification not found" });
//     }

//     // Execute the deletion as a separate query.
//     await client.query(
//       `DELETE FROM accepted 
//        WHERE notification_id = $1 
//          AND verification_status = false`,
//       [notification_id]
//     );

//     await client.query("COMMIT");
//     console.log("Transaction committed successfully for notification_id:", notification_id);

//     const { verified, worker_id, service_booked } = combinedQuery.rows[0];
//     console.log("Data:", combinedQuery.rows);

//     if (verified) {
//       return res.status(205).json({
//         message: "Cancellation blocked - verification already completed"
//       });
//     }

//     const fcmTokens = combinedQuery.rows
//       .filter(row => row.fcm_token)
//       .map(row => row.fcm_token);

//     const screen = "";
//     const encodedId = Buffer.from(notification_id.toString()).toString("base64");

//     if (fcmTokens.length > 0) {
//       try {
//         const multicastMessage = {
//           tokens: fcmTokens,
//           notification: {
//             title: "Click Solver",
//             body: "Sorry for this, User cancelled the Service.",
//           },
//           data: { screen: "Home" },
//         };
//         const response = await getMessaging().sendEachForMulticast(multicastMessage);
//         // (Keep your existing logging for FCM responses)
//       } catch (error) {
//         console.error("Error sending notifications:", error);
//       }
//     }
//     await createUserBackgroundAction(user_id, encodedId, screen, service_booked);
//     if (worker_id) {
//       await updateWorkerAction(worker_id, encodedId, screen);
//     } else {
//       console.error("No worker_id available to update worker action");
//     }

//     return res.status(200).json({ message: "Cancellation successful" });
//   } catch (error) {
//     await client.query("ROLLBACK");
//     console.error("Error processing request:", error);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// };

const userNavigationCancel = async (req, res) => {
  const { notification_id, offer_code } = req.body;
  const encodedUserNotificationId = Buffer.from(
    notification_id.toString()
  ).toString("base64");

  try {
    await client.query("BEGIN");
    console.log("Transaction started for notification_id:", notification_id);

    // 1) Update 'accepted', insert into 'completenotifications', update user offers, and fetch data
    const combinedQuery = await client.query(
      `
      WITH verification AS (
        SELECT
          verification_status,
          user_id,
          worker_id,
          service_booked
        FROM accepted
        WHERE notification_id = $1
      ),
      updated AS (
        UPDATE accepted
        SET user_navigation_cancel_status = 'usercanceled'
        WHERE notification_id = $1
          AND verification_status = FALSE
        RETURNING *
      ),
      inserted AS (
        INSERT INTO completenotifications (
          accepted_id, notification_id, user_id, user_notification_id,
          longitude, latitude, created_at, worker_id, complete_status,
          service_booked, time, discount, total_cost, tip_amount
        )
        SELECT
          accepted_id, notification_id, user_id, user_notification_id,
          longitude, latitude, created_at, worker_id, 'usercanceled',
          service_booked, time, discount, total_cost, tip_amount
        FROM updated
        RETURNING user_id, service_booked, worker_id
      ),
      user_updated AS (
        UPDATE "user" u
        SET offers_used = (
          SELECT jsonb_agg(
            CASE
              WHEN elem->>'offer_code' = $2
              THEN elem || '{"status":"pending"}'
              ELSE elem
            END
          )
          FROM jsonb_array_elements(u.offers_used) AS elem
        )
        WHERE u.user_id = (SELECT user_id FROM verification)
          AND EXISTS (
            SELECT 1 FROM updated a
            WHERE a.user_id = u.user_id
              AND a.coupons_applied IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(a.coupons_applied) ac
                WHERE ac->>'offer_code' = $2
              )
          )
        RETURNING u.user_id
      )
      SELECT
        v.verification_status AS verified,
        COALESCE(i.worker_id, v.worker_id) AS worker_id,
        v.user_id,
        v.service_booked,
        f.fcm_token
      FROM verification v
      LEFT JOIN inserted i      ON TRUE
      LEFT JOIN workersverified w ON w.worker_id = COALESCE(i.worker_id, v.worker_id)
      LEFT JOIN userfcm f       ON f.user_id   = v.user_id;
      `,
      [notification_id, offer_code]
    );

    // If no rows returned, nothing to cancel
    if (combinedQuery.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Cancellation not performed. Invalid ID or already canceled."
      });
    }

    // 2) Delete the original 'accepted' record
    await client.query(
      `DELETE FROM accepted
         WHERE notification_id = $1
           AND verification_status = FALSE`,
      [notification_id]
    );

    await client.query("COMMIT");
    console.log("Transaction committed successfully for notification_id:", notification_id);

    // 3) Destructure DB-sourced values
    const {
      verified,
      worker_id: workerId,
      user_id: dbUserId,
      service_booked: serviceBooked
    } = combinedQuery.rows[0];

    // If already verified, block cancel
    if (verified) {
      return res.status(205).json({
        message: "Cancellation blocked – verification already completed."
      });
    }

    // Gather FCM tokens
    const fcmTokens = combinedQuery.rows
      .map(r => r.fcm_token)
      .filter(Boolean);

    // 4) Send FCM notifications
    if (fcmTokens.length > 0) {
      try {
        await getMessaging().sendEachForMulticast({
          tokens: fcmTokens,
          notification: {
            title: "Click Solver",
            body: "Sorry, the user cancelled the service.",
          },
          data: { screen: "Home" },
        });
      } catch (err) {
        console.error("Error sending notifications:", err);
      }
    }

    // 5) Record background actions using the DB-sourced user ID
    const screen = "";
    await createUserBackgroundAction(
      dbUserId,
      encodedUserNotificationId,
      screen,
      serviceBooked
    );

    if (workerId) {
      await updateWorkerAction(
        workerId,
        encodedUserNotificationId,
        screen
      );
    } else {
      console.warn("No worker_id available for workerAction");
    }

    return res.status(200).json({ message: "Cancellation successful" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error processing request:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


// const workerNavigationCancel = async (req, res) => {
//   const { notification_id, offer_code } = req.body;
//   const encodedUserNotificationId = Buffer.from(notification_id.toString()).toString("base64");

//   try {
//     await client.query("BEGIN");
//     console.log("Transaction started for notification_id:", notification_id);

//     // Combined query: update accepted, insert into completenotifications, and update user
//     const combinedQuery = await client.query(
//       `
//       WITH updated AS (
//         UPDATE accepted
//         SET user_navigation_cancel_status = 'workercanceled'
//         WHERE notification_id = $1
//         RETURNING 
//           accepted_id, user_id, user_notification_id,
//           longitude, latitude, created_at, worker_id,
//           service_booked, time, discount, total_cost,
//           tip_amount, coupons_applied
//       ),
//       inserted AS (
//         INSERT INTO completenotifications (
//           accepted_id, notification_id, user_id, user_notification_id,
//           longitude, latitude, created_at, worker_id, complete_status,
//           service_booked, time, discount, total_cost, tip_amount
//         )
//         SELECT 
//           accepted_id, $1, user_id, user_notification_id,
//           longitude, latitude, created_at, worker_id, 'workercanceled',
//           service_booked, time, discount, total_cost, tip_amount
//         FROM updated
//         RETURNING user_id, service_booked
//       ),
//       user_updated AS (
//         UPDATE "user" AS u
//         SET offers_used = (
//           SELECT jsonb_agg(
//             CASE
//               WHEN elem->>'offer_code' = $2 THEN elem || '{"status": "pending"}'
//               ELSE elem
//             END
//           )
//           FROM jsonb_array_elements(u.offers_used) AS elem
//         )
//         WHERE u.user_id IN (SELECT user_id FROM updated)
//           AND EXISTS (
//             SELECT 1 FROM updated a
//             WHERE a.user_id = u.user_id
//               AND a.coupons_applied IS NOT NULL
//               AND EXISTS (
//                 SELECT 1 FROM jsonb_array_elements(a.coupons_applied) AS ac
//                 WHERE ac->>'offer_code' = $2
//               )
//           )
//         RETURNING u.user_id
//       )
//       SELECT 
//         i.user_id, 
//         f.fcm_token, 
//         i.service_booked,
//         i.worker_id
//       FROM inserted i
//       JOIN "user" w ON w.user_id = i.user_id
//       JOIN userfcm f ON f.user_id = w.user_id;
//       `,
//       [notification_id, offer_code]
//     );

//     // If no rows were returned, nothing was inserted
//     if (combinedQuery.rows.length === 0) {
//       await client.query("ROLLBACK");
//       return res.status(205).json({
//         message: "Cancellation not performed. Either invalid ID or already canceled."
//       });
//     }

//     // Execute the deletion as a separate query if the insertion succeeded
//     await client.query(
//       `DELETE FROM accepted WHERE notification_id = $1`,
//       [notification_id]
//     );

//     await client.query("COMMIT");
//     console.log("Transaction committed successfully for notification_id:", notification_id);

//     const { user_id, service_booked, worker_id } = combinedQuery.rows[0];
//     const fcmTokens = combinedQuery.rows
//       .map(row => row.fcm_token)
//       .filter(Boolean);

//     // FCM Notification Handling
//     if (fcmTokens.length > 0) {
//       try {
//         const multicastMessage = {
//           tokens: fcmTokens,
//           notification: {
//             title: "Click Solver",
//             body: "Sorry for this, User cancelled the Service.",
//           },
//           data: { screen: "Home" },
//         };
//         const response = await getMessaging().sendEachForMulticast(multicastMessage);
//         // Log or handle FCM response errors as needed
//       } catch (error) {
//         console.error("Error sending notifications:", error);
//       }
//     }

//     // Background action regardless of FCM tokens
//     await createUserBackgroundAction(
//       user_id,
//       encodedUserNotificationId,
//       "",
//       service_booked
//     );

//     await updateWorkerAction(worker_id, encodedUserNotificationId, "");

//     return res.status(200).json({ message: "Cancellation successful" });
//   } catch (error) {
//     await client.query("ROLLBACK");
//     console.error("Error processing request:", error);
//     return res.status(500).json({ error: "Internal server error" });
//   }
// };

const workerNavigationCancel = async (req, res) => {
  const { notification_id, offer_code } = req.body;
  const encodedUserNotificationId = Buffer.from(notification_id.toString()).toString("base64");

  try {
    await client.query("BEGIN");
    console.log("Transaction started for notification_id:", notification_id);

    const combinedQuery = await client.query(
      `
      WITH updated AS (
        UPDATE accepted
        SET user_navigation_cancel_status = 'workercanceled'
        WHERE notification_id = $1
        RETURNING
          accepted_id,
          user_id,
          user_notification_id,
          longitude,
          latitude,
          created_at,
          worker_id,
          service_booked,
          time,
          discount,
          total_cost,
          tip_amount,
          coupons_applied
      ),
      inserted AS (
        INSERT INTO completenotifications (
          accepted_id,
          notification_id,
          user_id,
          user_notification_id,
          longitude,
          latitude,
          created_at,
          worker_id,
          complete_status,
          service_booked,
          time,
          discount,
          total_cost,
          tip_amount
        )
        SELECT
          accepted_id,
          $1,
          user_id,
          user_notification_id,
          longitude,
          latitude,
          created_at,
          worker_id,
          'workercanceled',
          service_booked,
          time,
          discount,
          total_cost,
          tip_amount
        FROM updated
        RETURNING
          user_id,
          service_booked,
          worker_id
      ),
      user_updated AS (
        UPDATE "user" AS u
        SET offers_used = (
          SELECT jsonb_agg(
            CASE
              WHEN elem->>'offer_code' = $2 THEN elem || '{"status":"pending"}'
              ELSE elem
            END
          )
          FROM jsonb_array_elements(u.offers_used) AS elem
        )
        WHERE u.user_id IN (SELECT user_id FROM updated)
          AND EXISTS (
            SELECT 1
            FROM updated a
            WHERE a.user_id = u.user_id
              AND a.coupons_applied IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(a.coupons_applied) AS ac
                WHERE ac->>'offer_code' = $2
              )
          )
        RETURNING u.user_id
      )
      SELECT
        i.user_id,
        f.fcm_token,
        i.service_booked,
        i.worker_id
      FROM inserted i
      JOIN userfcm f ON f.user_id = i.user_id;
      `,
      [notification_id, offer_code]
    );

    // Nothing to cancel?
    if (combinedQuery.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(205).json({
        message: "Cancellation not performed. Either invalid ID or already canceled."
      });
    }

    // Now delete the original accepted record
    await client.query(
      `DELETE FROM accepted WHERE notification_id = $1`,
      [notification_id]
    );

    await client.query("COMMIT");
    console.log("Transaction committed successfully for notification_id:", notification_id);

    const { user_id, service_booked, worker_id } = combinedQuery.rows[0];
    const fcmTokens = combinedQuery.rows.map(r => r.fcm_token).filter(Boolean);

    // Send FCM notifications if any
    if (fcmTokens.length > 0) {
      try {
        const multicastMessage = {
          tokens: fcmTokens,
          notification: {
            title: "Click Solver",
            body: "Sorry for this, User cancelled the Service.",
          },
          data: { screen: "Home" },
        };
        await getMessaging().sendEachForMulticast(multicastMessage);
      } catch (error) {
        console.error("Error sending notifications:", error);
      }
    }

    // Fire off background actions
    await createUserBackgroundAction(
      user_id,
      encodedUserNotificationId,
      "",
      service_booked
    );
    await updateWorkerAction(
      worker_id,
      encodedUserNotificationId,
      ""
    );

    return res.status(200).json({ message: "Cancellation successful" });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error processing request:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const workCompletedRequest = async (req, res) => {
  const { notification_id } = req.body;
  // console.log("comp", notification_id);
  const encodedUserNotificationId = Buffer.from(
    notification_id.toString()
  ).toString("base64");

  try {
    // Query to get worker_id and fcm_tokens in one go using JOIN
    const result = await client.query(
      `
      SELECT f.worker_id, f.fcm_token 
      FROM accepted a
      JOIN fcm f ON a.worker_id = f.worker_id
      WHERE a.notification_id = $1
    `,
      [notification_id]
    );

    if (result.rows.length > 0) {
      const fcmTokens = result.rows.map((row) => row.fcm_token);
      // console.log(fcmTokens);

      if (fcmTokens.length > 0) {
        // Create a multicast message object for all tokens
        const multicastMessage = {
          tokens: fcmTokens,
          notification: {
            title: "Click Solver",
            body: `It is the request from user with work has completed successfully. Click the notification and confirm the work completion.`,
          },
          data: {
            notification_id: encodedUserNotificationId.toString(),
            screen: "TaskConfirmation",
          },
        };

        try {
          // Use sendEachForMulticast to send the same message to multiple tokens
          const response = await getMessaging().sendEachForMulticast(
            multicastMessage
          );

          // Log the responses for each token
          response.responses.forEach((res, index) => {
            if (res.success) {
              // console.log(`Message sent successfully to token ${fcmTokens[index]}`);
            } else {
              console.error(
                `Error sending message to token ${fcmTokens[index]}:`,
                res.error
              );
            }
          });

          // console.log('Success Count:', response.successCount);
          // console.log('Failure Count:', response.failureCount);
        } catch (error) {
          console.error("Error sending notifications:", error);
        }
      } else {
        console.error("No FCM tokens to send the message to.");
      }

      res.status(200).json({
        message: "Status updated to accept",
      });
    } else {
      res.status(205).json({
        message: "Nothing sent",
      });
    }
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const addWorker = async (worker) => {
  const { name, phone_number } = worker;
  const created_at = getCurrentTimestamp();
  try {
    const result = await client.query(
      'INSERT INTO "workersverified" ( name, phone_number, created_at) VALUES ( $1, $2, $3) RETURNING *',
      [name, phone_number, created_at]
    );
    return result.rows[0];
  } catch (err) {
    console.error("Error adding user:", err);
    throw err;
  }
};

const userCancelNavigation = async (req, res) => {
  const { notification_id } = req.body;

  if (!notification_id) {
    return res.status(400).json({ error: "Notification ID is required" });
  }

  try {
    // Update the status and check current status in a single query using RETURNING
    const query = `
      UPDATE accepted
      SET user_navigation_cancel_status = 'usercanceled'
      WHERE notification_id = $1
      AND (user_navigation_cancel_status IS NULL OR user_navigation_cancel_status != 'timeup')
      RETURNING user_navigation_cancel_status;
    `;

    const result = await client.query(query, [notification_id]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Cancellation time is up or Notification not found" });
    }

    const updatedStatus = result.rows[0].user_navigation_cancel_status;

    // Check if the status was already updated to 'timeup'
    if (updatedStatus === "timeup") {
      return res.status(404).json({ error: "Cancellation time is up" });
    }

    return res.status(200).json({ message: "Cancellation successful" });
  } catch (error) {
    console.error("Error updating cancellation status:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

const workerCancelNavigation = async (req, res) => {
  const { notification_id } = req.body;

  if (!notification_id) {
    return res.status(400).json({ error: "Notification ID is required" });
  }

  try {
    // Combine status check and update in one query
    const query = `
      UPDATE accepted
      SET navigation_status = 'workercanceled'
      WHERE notification_id = $1
      AND (navigation_status IS NULL OR navigation_status != 'timeup')
      RETURNING navigation_status;
    `;

    const result = await client.query(query, [notification_id]);

    // If no rows were returned, the notification either doesn't exist or the status is 'timeup'
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Cancellation time is up or Notification not found" });
    }

    const updatedStatus = result.rows[0].navigation_status;

    // If the updated status is 'timeup', cancellation is not allowed
    if (updatedStatus === "timeup") {
      return res.status(404).json({ error: "Cancellation time is up" });
    }

    return res.status(200).json({ message: "Cancellation successful" });
  } catch (error) {
    console.error("Error updating cancellation status:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

// Haversine formula to calculate the distance between two points on the Earth's surface
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const R = 6371; // Radius of the Earth in km

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
};

const generatePin = () => {
  return Math.floor(1000 + Math.random() * 9000); // Generates a 4-digit random number
};

const formattedDate = () => {
  const currentDateTime = new Date();
  return currentDateTime.toLocaleDateString();
};

const formattedTime = () => {
  const currentDateTime = new Date();
  return currentDateTime.toLocaleTimeString();
};

/**
 * getWorkersNearby
 * 1) Insert userNotifications
 * 2) Identify workers with matching subservices + no due
 * 3) Fetch worker locations from Firestore
 * 4) Filter by 2km radius using Haversine
 * 5) Insert notifications for nearby workers & retrieve FCM tokens
 * 6) Send FCM
 */
const getWorkersNearby = async (req, res) => {
  try {
    // ------------------------------------------------------------------
    //  1) Extract request data
    // ------------------------------------------------------------------
    const user_id = req.user.id;
    const {
      area,
      pincode,
      city,
      alternateName,
      alternatePhoneNumber,
      serviceBooked,   // array of { serviceName, cost }
      discount,
      tipAmount,
      offer
    } = req.body;

    console.log("req.body",req.body)

    const created_at = getCurrentTimestamp();
    const serviceArray = JSON.stringify(serviceBooked);   // e.g. '[{"serviceName":"...","cost": 250}, ...]'
    const serviceNames = serviceBooked.map((s) => s.serviceName);
    const totalCost =
      serviceBooked.reduce((acc, s) => acc + s.cost, 0) - discount + tipAmount;

    // ------------------------------------------------------------------
    //  2) Postgres Query #1: Insert userNotifications, find matching workers
    // ------------------------------------------------------------------
    const query1 = `
      WITH user_loc AS (
        SELECT u.user_id, ul.longitude, ul.latitude
        FROM "user" u
        JOIN userlocation ul ON u.user_id = ul.user_id
        WHERE u.user_id = $1
      ),
      inserted_user_notifications AS (
        INSERT INTO userNotifications (
          user_id, longitude, latitude, created_at,
          area, pincode, city, alternate_name,
          alternate_phone_number, service_booked
        )
        SELECT
          user_loc.user_id,
          user_loc.longitude,
          user_loc.latitude,
          $2,  -- created_at
          $3,  -- area
          $4,  -- pincode
          $5,  -- city
          $6,  -- alternateName
          $7,  -- alternatePhoneNumber
          $8   -- serviceArray
        FROM user_loc
        RETURNING user_notification_id
      ),
      matching_workers AS (
        SELECT ws.worker_id
        FROM workerskills ws
        JOIN workersverified wv ON ws.worker_id = wv.worker_id
        WHERE $9::text[] <@ ws.subservices
          AND wv.no_due = TRUE  -- Ensure workers have no due payments
        GROUP BY ws.worker_id
      )
      SELECT
        (SELECT user_notification_id FROM inserted_user_notifications) AS user_notification_id,
        array_agg(mw.worker_id) AS worker_ids,
        (SELECT latitude FROM user_loc) AS user_lat,
        (SELECT longitude FROM user_loc) AS user_lon
      FROM matching_workers mw;
    `;

    const query1Params = [
      user_id,           // $1
      created_at,        // $2
      area,              // $3
      pincode,           // $4
      city,              // $5
      alternateName,     // $6
      alternatePhoneNumber, // $7
      serviceArray,      // $8
      serviceNames,      // $9 :: text[]
    ];

    const result1 = await client.query(query1, query1Params);
    if (result1.rows.length === 0) {
      return res
        .status(404)
        .json("No user found or no worker matches subservices");
    }

    const { user_notification_id, worker_ids, user_lat, user_lon } = result1.rows[0];

    if (!user_notification_id) {
      return res.status(404).json("Failed to insert user notification");
    }
    if (!worker_ids || worker_ids.length === 0) {
      return res.status(200).json("No workers match the requested subservices");
    }

    // ------------------------------------------------------------------
    //  3) Firestore: Get worker locations once, filter by 2km radius
    // ------------------------------------------------------------------
    const workerDb = await getAllLocations(worker_ids); 
    if (!workerDb || workerDb.length === 0) {
      return res.status(200).json("No Firestore location data for these workers");
    }

    const MAX_DISTANCE = 2; // 2km
    const nearbyWorkers = [];
    for (const doc of workerDb) {
      const dist = haversineDistance(
        user_lat,
        user_lon,
        doc.location._latitude,
        doc.location._longitude
      );
      if (dist <= MAX_DISTANCE) {
        nearbyWorkers.push(doc.worker_id);
      }
    }

    if (nearbyWorkers.length === 0) {
      return res.status(200).json("No workers found within 2 km radius");
    }

    // ------------------------------------------------------------------
    //  4) Postgres Query #2: Insert notifications & retrieve FCM tokens
    // ------------------------------------------------------------------
    const pin = generatePin(); // e.g. 4-6 digit pin
    const query2 = `
      WITH insert_notifications AS (
        INSERT INTO notifications (
          user_notification_id, user_id, worker_id,
          longitude, latitude, created_at, pin, service_booked,
          discount, coupons_applied, total_cost, tip_amount
        )
        SELECT
          $1,  -- user_notification_id
          $2,  -- user_id
          w.worker_id,
          $3,  -- user_lon
          $4,  -- user_lat
          $5,  -- created_at
          $6,  -- pin
          $7,  -- serviceArray
          $9,  -- discount
          $12, -- coupons_applied
          $10, -- totalCost
          $11  -- tipAmount
        FROM UNNEST($8::int[]) AS w(worker_id)
        RETURNING worker_id
      ),
      fcm_tokens AS (
        SELECT fcm_token
        FROM fcm
        WHERE worker_id IN (SELECT worker_id FROM insert_notifications)
      )
      SELECT array_agg(fcm_token) AS tokens 
      FROM fcm_tokens;
    `;

    const query2Params = [
      user_notification_id, // $1
      user_id,              // $2
      user_lon,             // $3
      user_lat,             // $4
      created_at,           // $5
      pin,                  // $6
      serviceArray,         // $7
      nearbyWorkers,        // $8 :: int[]
      discount,             // $9
      totalCost,            // $10
      tipAmount,            // $11
      offer                 // $12 (for coupons_applied)
    ];

    const result2 = await client.query(query2, query2Params);
    const tokens = result2.rows[0].tokens || [];

    // ------------------------------------------------------------------
    //  5) If Offer Provided, Update "offers_used" with 'status: applied'
    // ------------------------------------------------------------------
    if (offer) {
      const offerCodeValue = offer.offer_code;
      const queryText = `
        UPDATE "user"
        SET offers_used = (
          SELECT jsonb_agg(
            CASE
              WHEN elem->>'offer_code' = $1
                THEN elem || '{"status":"applied"}'
              ELSE elem
            END
          )
          FROM jsonb_array_elements("user".offers_used) elem
        )
        WHERE user_id = $2
      `;
      await client.query(queryText, [offerCodeValue, user_id]);
    }

    // ------------------------------------------------------------------
    //  6) Send FCM notifications (if tokens exist)
    // ------------------------------------------------------------------
    const encodedUserNotificationId = Buffer.from(
      user_notification_id.toString()
    ).toString("base64");

    if (tokens.length > 0) {
      const normalNotificationMessage = {
        tokens,
        notification: {
          title:  "🔔 ClickSolver Has a Job for You!",
          body:   "💼 A user needs help! Accept now to support your ClickSolver family. 🤝"
        },
        data: {
          user_notification_id: encodedUserNotificationId,
          service: serviceArray,
          location: `${area}, ${city}, ${pincode}`,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          cost: totalCost.toString(),
          targetUrl: `/acceptance/${encodedUserNotificationId}`,
          screen: "Acceptance",
          date: formattedDate(),
          time: formattedTime(),
          type: "normal",
        },
        android: { priority: "high" },
      };

      try {
        const fcmResponse = await getMessaging().sendEachForMulticast(normalNotificationMessage);
        
        // Optional: track success/failure
        let successCount = 0;
        let failureCount = 0;
        fcmResponse.responses.forEach((resp, idx) => {
          if (resp.success) {
            successCount++;
          } else {
            failureCount++;
            console.error(`❌ Error sending to token ${tokens[idx]}:`, resp.error);
          }
        });
        console.log(`FCM Summary: ${successCount} success, ${failureCount} failures.`);
      } catch (err) {
        console.error("❌ Error sending FCM notifications:", err);
      }
    }

    // ------------------------------------------------------------------
    //  7) Return to Client
    // ------------------------------------------------------------------
    return res.status(200).json(encodedUserNotificationId);
  } catch (error) {
    console.error("Error in getWorkersNearby:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

const checkTaskStatus = async (req, res) => {
  const { notification_id } = req.body;

  try {
    // Directly check the result in the if condition to reduce extra variables
    const result = await client.query(
      "SELECT end_time FROM servicecall WHERE notification_id = $1",
      [notification_id]
    );

    if (result.rows.length === 0) {
      // Return early if no notification is found
      return res.status(205).json({ message: "Notification not found" });
    }

    const end_time = result.rows[0].end_time;

    if (end_time) {
      // Return status if end_time is found
      return res.status(200).json({ status: end_time });
    }

    // If end_time is null, return a notification not found response
    return res.status(205).json({ message: "Notification not found" });
  } catch (error) {
    console.error("Error checking status:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const checkStatus = async (req, res) => {
  const { user_notification_id } = req.query;

  try {
    const result = await client.query(
      "SELECT 1 FROM notifications WHERE user_notification_id = $1",
      [user_notification_id]
    );

    if (result.rows.length > 0) {
      // user_notification_id exists in the notifications table
      res.sendStatus(200);
    } else {
      // user_notification_id does not exist in the notifications table
      res.sendStatus(201);
    }
  } catch (error) {
    console.error("Error checking notification:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const getElectricianServices = async () => {
  try {
    const result = await client.query(
      'SELECT * FROM "services" WHERE service_title = $1',
      ["Electrician Services"]
    );
    return result.rows;
  } catch (err) {
    console.error("Error fetching electrician services:", err);
    throw err;
  }
};

const getPlumberServices = async () => {
  try {
    const result = await client.query(
      'SELECT * FROM "services" WHERE service_title = $1',
      ["Plumber"]
    );
    return result.rows;
  } catch (err) {
    console.error("Error fetching Plumber services:", err);
    throw err;
  }
};

const getVerificationStatus = async (req, res) => {
  const { notification_id } = req.query;

  if (!notification_id) {
    return res.status(400).json({ error: "Notification ID is required" });
  }

  try {
    const result = await client.query(
      "SELECT verification_status FROM accepted WHERE notification_id = $1",
      [notification_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification ID not found" });
    }

    const verificationStatus = result.rows[0].verification_status;
    res.json(verificationStatus);
  } catch (error) {
    console.error("Error checking verification status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// const workerVerifyOtp = async (req, res) => {
//   const { notification_id, otp } = req.body;

//   try {
//     // Update the accepted table and return only the fields needed for subsequent logic.
//     const query = `
//       WITH updated AS (
//         UPDATE accepted
//         SET 
//           verification_status = TRUE,
//           time = jsonb_set(
//             COALESCE(time, '{}'::jsonb),
//             '{arrived}',
//             to_jsonb(to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
//           )
//         WHERE notification_id = $1 AND pin = $2
//         RETURNING user_id, user_navigation_cancel_status, service_booked,worker_id
//       )
//       SELECT 
//         updated.user_navigation_cancel_status,
//         updated.user_id,
//         updated.service_booked,
//         worker_id,
//         ARRAY_AGG(u.fcm_token) AS fcm_tokens
//       FROM updated
//       LEFT JOIN userfcm u ON updated.user_id = u.user_id
//       GROUP BY updated.user_navigation_cancel_status, updated.user_id, updated.service_booked;
//     `;

//     const queryResult = await client.query(query, [notification_id, otp]);

//     // If no row was updated, the OTP is incorrect or notification not found.
//     if (queryResult.rows.length === 0) {
//       return res
//         .status(404)
//         .json({ message: "OTP is incorrect or notification not found." });
//     }

//     const {
//       user_navigation_cancel_status,
//       user_id,
//       service_booked,
//       fcm_tokens,
//       worker_id
//     } = queryResult.rows[0];

//     const filteredFcmTokens = fcm_tokens ? fcm_tokens.filter(token => token) : [];

//     // If the user cancelled navigation, return HTTP 205.
//     if (user_navigation_cancel_status === "usercanceled") {
//       return res
//         .status(205)
//         .json({ message: "User cancelled the navigation." });
//     }

//     // Start the time.
//     await TimeStart(notification_id);

//     // Send notifications if FCM tokens exist.
//     if (filteredFcmTokens.length > 0) {
//       const multicastMessage = {
//         tokens: filteredFcmTokens,
//         notification: {
//           title: "Click Solver",
//           body: "The Commander has successfully verified the work. The time has started.",
//         },
//         data: {
//           notification_id: notification_id.toString(),
//           screen: "worktimescreen",
//         },
//       };

//       try {
//         const response = await getMessaging().sendEachForMulticast(multicastMessage);
//         response.responses.forEach((resItem, index) => {
//           if (!resItem.success) {
//             console.error(
//               `Error sending message to token ${filteredFcmTokens[index]}:`,
//               resItem.error
//             );
//           }
//         });
//       } catch (error) {
//         console.error("Error sending notifications:", error);
//       }
//     } else {
//       console.error("No FCM tokens to send the message to.");
//     }

//     const screen = "worktimescreen";
//     const encodedId = Buffer.from(notification_id.toString()).toString("base64");
//     await createUserBackgroundAction(user_id, encodedId, screen, service_booked);
//     await updateWorkerAction(worker_id, encodedId, screen);

//     // If everything is successful, send only HTTP 200 to the frontend.
//     return res.status(200).json({ status: "Verification successful" });
//   } catch (error) {
//     console.error("Error verifying OTP:", error);
//     return res.status(500).json({ message: "Internal server error" });
//   }
// };

const workerVerifyOtp = async (req, res) => {
  const { notification_id, otp } = req.body;

  try {
    const query = `
      WITH updated AS (
        UPDATE accepted
        SET 
          verification_status = TRUE,
          time = jsonb_set(
            COALESCE(time, '{}'::jsonb),
            '{arrived}',
            to_jsonb(to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))
          )
        WHERE notification_id = $1
          AND pin = $2
        RETURNING
          user_id,
          user_navigation_cancel_status,
          service_booked,
          worker_id
      )
      SELECT 
        u.user_navigation_cancel_status,
        u.user_id,
        u.service_booked,
        u.worker_id,
        COALESCE(ARRAY_AGG(f.fcm_token), '{}') AS fcm_tokens
      FROM updated u
      LEFT JOIN userfcm f
        ON f.user_id = u.user_id
      GROUP BY
        u.user_navigation_cancel_status,
        u.user_id,
        u.service_booked,
        u.worker_id;
    `;

    const { rows } = await client.query(query, [notification_id, otp]);

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ message: "OTP is incorrect or notification not found." });
    }

    const {
      user_navigation_cancel_status,
      user_id,
      service_booked,
      worker_id,
      fcm_tokens,
    } = rows[0];

    // If the user cancelled navigation, return HTTP 205
    if (user_navigation_cancel_status === "usercanceled") {
      return res
        .status(205)
        .json({ message: "User cancelled the navigation." });
    }

    // Kick off the timer
    await TimeStart(notification_id);

    // Send notifications if tokens exist
    const validTokens = fcm_tokens.filter(Boolean);
    if (validTokens.length) {
      try {
        const multicastMessage = {
          tokens: validTokens,
          notification: {
            title: "Click Solver",
            body: "The Commander has successfully verified the work. The time has started.",
          },
          data: {
            notification_id: notification_id.toString(),
            screen: "worktimescreen",
          },
        };
        const resp = await getMessaging().sendEachForMulticast(multicastMessage);
        resp.responses.forEach((r, i) => {
          if (!r.success) {
            console.error(`FCM error for ${validTokens[i]}:`, r.error);
          }
        });
      } catch (err) {
        console.error("Error sending notifications:", err);
      }
    } else {
      console.warn("No FCM tokens to send the message to.");
    }

    // Record background actions
    const screen = "worktimescreen";
    const encodedId = Buffer.from(notification_id.toString()).toString("base64");
    await createUserBackgroundAction(user_id, encodedId, screen, service_booked);
    await updateWorkerAction(worker_id, encodedId, screen);

    return res.status(200).json({ status: "Verification successful" });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


const getCleaningServices = async () => {
  try {
    const result = await client.query(
      'SELECT * FROM "services" WHERE service_title = $1',
      ["Cleaning Department"]
    );
    return result.rows;
  } catch (err) {
    console.error("Error fetching Cleaning services:", err);
    throw err;
  }
};

const getPaintingServices = async () => {
  try {
    const result = await client.query(
      'SELECT * FROM "services" WHERE service_title = $1',
      ["House and Shop Painting"]
    );
    return result.rows;
  } catch (err) {
    console.error("Error fetching Painter services:", err);
    throw err;
  }
};

const getVehicleServices = async () => {
  try {
    const result = await client.query(
      'SELECT * FROM "services" WHERE service_title IN ($1, $2)',
      ["Vehical mechanics", "Salon for mens & kids"]
    );
    return result.rows;
  } catch (err) {
    console.error("Error fetching Vehicle services:", err);
    throw err;
  }
};

const sendOtp = (req, res) => {
  const { mobileNumber } = req.body;
  if (!mobileNumber) {
    return res.status(400).json({ message: "Mobile number is required" });
  }

  const options = {
    method: "POST",
    url: `https://cpaas.messagecentral.com/verification/v3/send?countryCode=91&customerId=${process.env.CUSTOMER_ID}&flowType=SMS&mobileNumber=${mobileNumber}`,
    headers: {
      authToken: "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJDLUIzNzUzRUNBNDNCRDQzNSIsImlhdCI6MTcyNjI1OTQwNiwiZXhwIjoxODgzOTM5NDA2fQ.Gme6ijpbtUge-n9NpEgJR7lIsNQTqH4kDWkoe9Wp6Nnd6AE0jaAKCuuGuYtkilkBrcC1wCj8GrlMNQodR-Gelg",
    },
  };

  request(options, (error, response, body) => {
    if (error) {
      console.error("Error sending OTP:", error);
      return res.status(500).json({ message: "Error sending OTP", error });
    }
    try {
      const data = JSON.parse(body);
      if (data && data.data && data.data.verificationId) {
        return res.status(200).json({
          message: "OTP sent successfully",
          verificationId: data.data.verificationId,
        });
      } else {
        return res.status(500).json({
          message: "Failed to retrieve verificationId",
          error: data,
        });
      }
    } catch (parseError) {
      console.error("Error parsing OTP response:", parseError);
      return res.status(500).json({ message: "Failed to parse response", error: parseError });
    }
  });
};

const partnerSendOtp = (req, res) => {
  const { mobileNumber } = req.body;
  if (!mobileNumber) {
    return res.status(400).json({ message: "Mobile number is required" });
  }

  const options = {
    method: "POST",
    url: `https://cpaas.messagecentral.com/verification/v3/send?countryCode=91&customerId=${process.env.WORKER_CUSTOMER_ID}&flowType=SMS&mobileNumber=${mobileNumber}`,
    headers: {
      authToken: "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJDLTI0OEY5ODhBOUQ5QzQzOCIsImlhdCI6MTc0NTY4Mjk3NywiZXhwIjoxOTAzMzYyOTc3fQ.9-y_44egQuG0MuLs08d7gLWKxkSGW8ldsceKotcrTzP8Dl2XqrSXZGpVtkPJQAL-LJ-HCTPnab1FVHn-A_IJRA",
    },
  };

  request(options, (error, response, body) => {
    if (error) {
      console.error("Error sending OTP:", error);
      return res.status(500).json({ message: "Error sending OTP", error });
    }
    try {
      const data = JSON.parse(body);
      if (data && data.data && data.data.verificationId) {
        return res.status(200).json({
          message: "OTP sent successfully",
          verificationId: data.data.verificationId,
        });
      } else {
        return res.status(500).json({
          message: "Failed to retrieve verificationId",
          error: data,
        });
      }
    } catch (parseError) {
      console.error("Error parsing OTP response:", parseError);
      return res.status(500).json({ message: "Failed to parse response", error: parseError });
    }
  });
};

const partnerValidateOtp = (req, res) => {
  // Expecting mobileNumber, verificationId, and otpCode as query parameters
  const { mobileNumber, verificationId, otpCode } = req.query;
  if (!mobileNumber || !verificationId || !otpCode) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  const options = {
    method: "GET",
    url: `https://cpaas.messagecentral.com/verification/v3/validateOtp?countryCode=91&mobileNumber=${mobileNumber}&verificationId=${verificationId}&customerId=${process.env.WORKER_CUSTOMER_ID}&code=${otpCode}`,
    headers: {
      authToken: "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJDLTI0OEY5ODhBOUQ5QzQzOCIsImlhdCI6MTc0NTY4Mjk3NywiZXhwIjoxOTAzMzYyOTc3fQ.9-y_44egQuG0MuLs08d7gLWKxkSGW8ldsceKotcrTzP8Dl2XqrSXZGpVtkPJQAL-LJ-HCTPnab1FVHn-A_IJRA",
    },
  };

  request(options, (error, response, body) => {
    if (error) {
      console.error("Error validating OTP:", error);
      return res.status(500).json({ message: "Error validating OTP", error });
    }
    try {
      const data = JSON.parse(body);
      if (
        data &&
        data.data &&
        data.data.verificationStatus === "VERIFICATION_COMPLETED"
      ) {
        return res.status(200).json({ message: "OTP Verified" });
      } else {
        return res.status(200).json({ message: "Invalid OTP" });
      }
    } catch (parseError) {
      console.error("Error parsing OTP validation response:", parseError);
      return res.status(500).json({ message: "Failed to parse response", error: parseError });
    }
  });
};

// VALIDATE OTP FUNCTION
const validateOtp = (req, res) => {
  // Expecting mobileNumber, verificationId, and otpCode as query parameters
  const { mobileNumber, verificationId, otpCode } = req.query;
  if (!mobileNumber || !verificationId || !otpCode) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  const options = {
    method: "GET",
    url: `https://cpaas.messagecentral.com/verification/v3/validateOtp?countryCode=91&mobileNumber=${mobileNumber}&verificationId=${verificationId}&customerId=${process.env.CUSTOMER_ID}&code=${otpCode}`,
    headers: {
      authToken: "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJDLUIzNzUzRUNBNDNCRDQzNSIsImlhdCI6MTcyNjI1OTQwNiwiZXhwIjoxODgzOTM5NDA2fQ.Gme6ijpbtUge-n9NpEgJR7lIsNQTqH4kDWkoe9Wp6Nnd6AE0jaAKCuuGuYtkilkBrcC1wCj8GrlMNQodR-Gelg",
    },
  };

  request(options, (error, response, body) => {
    if (error) {
      console.error("Error validating OTP:", error);
      return res.status(500).json({ message: "Error validating OTP", error });
    }
    try {
      const data = JSON.parse(body);
      if (
        data &&
        data.data &&
        data.data.verificationStatus === "VERIFICATION_COMPLETED"
      ) {
        return res.status(200).json({ message: "OTP Verified" });
      } else {
        return res.status(200).json({ message: "Invalid OTP" });
      }
    } catch (parseError) {
      console.error("Error parsing OTP validation response:", parseError);
      return res.status(500).json({ message: "Failed to parse response", error: parseError });
    }
  });
};

const CheckStartTime = async (req, res) => {
  const { notification_id } = req.body;

  try {
    // Use LEFT JOIN to get start_time, worker_id, and payment in a single query
    const result = await client.query(
      `SELECT sc.start_time, 
              COALESCE(sc.worker_id, a.worker_id) AS worker_id,
              COALESCE(sc.payment, a.total_cost) AS payment
       FROM ServiceCall sc 
       LEFT JOIN accepted a 
       ON sc.notification_id = a.notification_id 
       WHERE sc.notification_id = $1 OR a.notification_id = $1`,
      [notification_id]
    );

    if (result.rows.length > 0) {
      const { start_time, worker_id, payment } = result.rows[0];

      if (start_time) {
        // If start_time exists, return it
        return res.status(200).json({ worked_time: start_time, worker_id, payment });
      } else if (worker_id) {
        // If start_time doesn't exist, insert current timestamp into ServiceCall
        const currentTime = getCurrentTimestamp();
        await client.query(
          "INSERT INTO ServiceCall (notification_id, worker_id, start_time, payment) VALUES ($1, $2, $3, $4)",
          [notification_id, worker_id, currentTime, payment]
        );

        return res.status(200).json({ worked_time: currentTime, worker_id, payment });
      }
    }

    // If no worker_id is found in both tables, return a 404
    return res.status(404).json({
      error: "Notification ID not found in ServiceCall or accepted table",
    });
  } catch (error) {
    console.error("Error fetching or inserting start time:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const getTimerValue = async (req, res) => {
  const { notification_id } = req.body; // Extract notification_id from query parameters
  // console.log("notification denedhe", notification_id);
  try {
    const result = await client.query(
      "SELECT time_worked FROM ServiceCall WHERE notification_id = $1",
      [notification_id]
    );
    // console.log(result.rows)

    if (result.rows.length > 0) {
      const workedTime = result.rows[0].time_worked;
      if (workedTime) {
        res.status(200).json(workedTime);
      } else {
        res.status(200).json("00:00:00");
      }
    } else {
      res.status(404).json({ error: "Notification ID not found" });
    }
  } catch (error) {
    console.error("Error fetching timer value:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

let stopwatchInterval = null;
let workedTime = 0;
const activeNotifications = new Set();

const formatTime = (seconds) => {
  const hrs = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0");
  const mins = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${hrs}:${mins}:${secs}`;
};

const parseTime = (timeString) => {
  if (typeof timeString !== "string") {
    return 0; // or some default value
  }
  const [hrs, mins, secs] = timeString.split(":").map(Number);
  return hrs * 3600 + mins * 60 + secs;
};

// Adjusted startStopwatch function
const startStopwatch = async (notificationId) => {
  // Check if stopwatch is already running for this notificationId
  if (activeNotifications.has(notificationId)) {
    // console.log(`Stopwatch for notification ID ${notificationId} is already running.`);
    // Return the current worked time if it's already running
    const result = await client.query(
      "SELECT time_worked FROM ServiceCall WHERE notification_id = $1",
      [notificationId]
    );
    if (result.rows.length > 0 && result.rows[0].time_worked !== null) {
      const workedTimeString = result.rows[0].time_worked;
      return workedTimeString; // Return the existing time worked
    }
  }

  try {
    // Query the database to get worker_id from notifications table
    const workerResult = await client.query(
      "SELECT worker_id FROM accepted WHERE notification_id = $1",
      [notificationId]
    );

    if (workerResult.rows.length === 0) {
      throw new Error("No worker found for the given notification ID");
    }

    const workerId = workerResult.rows[0].worker_id;

    // Query the database to check if there's already time worked for this notificationId
    const result = await client.query(
      "SELECT time_worked FROM ServiceCall WHERE notification_id = $1",
      [notificationId]
    );

    let workedTime = 0;

    if (result.rows.length > 0 && result.rows[0].time_worked !== null) {
      // If time worked exists, parse it from the database
      const workedTimeString = result.rows[0].time_worked;
      workedTime = parseTime(workedTimeString);
    } else {
      // If no time worked exists, initialize it to 0 in the database and insert worker_id
      workedTime = 0;
      await client.query(
        "INSERT INTO ServiceCall (notification_id, start_time, time_worked, worker_id) VALUES ($1, $2, $3, $4)",
        [notificationId, new Date(), formatTime(workedTime), workerId]
      );
    }

    // Add the notificationId to activeNotifications to indicate it's running
    activeNotifications.add(notificationId);

    // Set up the interval to update time worked every second
    if (!stopwatchInterval) {
      stopwatchInterval = setInterval(async () => {
        workedTime += 1;

        try {
          const formattedTime = formatTime(workedTime);
          // console.log(formattedTime)
          // Log formatted time for debugging

          // Update the time worked in the database
          await client.query(
            "UPDATE ServiceCall SET time_worked = $1 WHERE notification_id = $2",
            [formattedTime, notificationId]
          );
        } catch (error) {
          console.error("Error formatting or updating worked time:", error);
        }
      }, 1000);
    }
  } catch (error) {
    console.error("Error starting stopwatch:", error);
    throw error; // Ensure errors are properly handled
  }
};

const getTimeDifferenceInIST = (start_time, end_time) => {
  // Parse input times
  const startTime = new Date(start_time);
  const endTime = new Date(end_time);

  // Calculate the difference in milliseconds
  const differenceInMillis = endTime - startTime;

  // Convert milliseconds to seconds
  const differenceInSeconds = Math.floor(differenceInMillis / 1000);

  // Calculate hours, minutes, and seconds
  const hours = Math.floor(differenceInSeconds / 3600);
  const minutes = Math.floor((differenceInSeconds % 3600) / 60);
  const seconds = differenceInSeconds % 60;

  // Format to hh:mm:ss with leading zeros
  const formatTime = (value) => value.toString().padStart(2, "0");
  const time_worked = `${formatTime(hours)}:${formatTime(minutes)}:${formatTime(
    seconds
  )}`;
  return { time_worked };
};

// const serviceCompleted = async (req, res) => {
//   const { notification_id, encodedId } = req.body;

//   // Input Validation
//   if (!notification_id || !encodedId) {
//     return res.status(400).json({
//       error: "Missing required fields: notification_id and encodedId.",
//     });
//   }

//   try {
//     const end_time = new Date();

//     // Single query using CTEs to fetch, check, update, and return only necessary data.
//     const query = `
//       WITH fetched_data AS (
//         SELECT 
//           sc.notification_id,
//           sc.start_time, 
//           sc.end_time, 
//           a.user_id, 
//           a.service_booked,
//           a.worker_id
//         FROM servicecall sc
//         JOIN accepted a ON sc.notification_id = a.notification_id
//         WHERE sc.notification_id = $1
//         FOR UPDATE
//       ),
//       check_end_time AS (
//         SELECT 
//           start_time,
//           user_id,
//           service_booked,
//           CASE 
//             WHEN end_time IS NOT NULL THEN TRUE 
//             ELSE FALSE 
//           END AS is_end_time_set
//         FROM fetched_data
//       ),
//       update_servicecall AS (
//         UPDATE servicecall sc
//         SET 
//           end_time = $2,
//           time_worked = TO_CHAR(EXTRACT(EPOCH FROM ($2 - sc.start_time)) / 3600, 'FM00') || ':' ||
//                         TO_CHAR((EXTRACT(EPOCH FROM ($2 - sc.start_time)) / 60) % 60, 'FM00') || ':' ||
//                         TO_CHAR(EXTRACT(EPOCH FROM ($2 - sc.start_time)) % 60, 'FM00')
//         FROM fetched_data fd
//         WHERE sc.notification_id = fd.notification_id AND sc.end_time IS NULL
//         RETURNING end_time AS updated_end_time, time_worked AS updated_time_worked
//       ),
//       update_accepted AS (
//         UPDATE accepted a
//         SET 
//           time = jsonb_set(
//             COALESCE(a.time, '{}'::jsonb),
//             '{workCompleted}',
//             to_jsonb(to_char($2, 'YYYY-MM-DD HH24:MI:SS'))
//           )
//         FROM fetched_data fd
//         WHERE a.notification_id = fd.notification_id
//         RETURNING time AS updated_time
//       ),
//       user_fcm AS (
//         SELECT ARRAY_AGG(u.fcm_token) AS fcm_tokens
//         FROM userfcm u
//         WHERE u.user_id = (SELECT user_id FROM fetched_data LIMIT 1)
//       )
//       SELECT 
//         cd.start_time,
//         cd.user_id,
//         cd.service_booked,
//         cd.is_end_time_set,
//         us.updated_end_time,
//         us.updated_time_worked,
//         ua.updated_time,
//         uf.fcm_tokens
//       FROM check_end_time cd
//       LEFT JOIN update_servicecall us ON TRUE
//       LEFT JOIN update_accepted ua ON TRUE
//       CROSS JOIN user_fcm uf;
//     `;

//     const values = [notification_id, end_time];

//     const result = await client.query(query, values);

//     // Check if any records were returned.
//     if (result.rows.length === 0) {
//       return res.status(404).json({ error: "Notification not found." });
//     }

//     const {
//       start_time,
//       user_id,
//       service_booked,
//       is_end_time_set,
//       updated_end_time,
//       updated_time_worked,
//       updated_time,
//       fcm_tokens,
//       worker_id
//     } = result.rows[0];

//     // If end_time is already set, return a 205 status.
//     if (is_end_time_set) {
//       return res.status(205).json({ message: "End time already set." });
//     }

//     // Determine the time_worked value.
//     let time_worked = updated_time_worked;
//     if (!is_end_time_set && updated_time_worked) {
//       // Use updated_time_worked if available.
//       time_worked = updated_time_worked;
//     } else {
//       // Fallback calculation in application code.
//       const timeWorkedInSeconds = Math.floor((end_time - start_time) / 1000);
//       const hours = String(Math.floor(timeWorkedInSeconds / 3600)).padStart(2, "0");
//       const minutes = String(Math.floor((timeWorkedInSeconds % 3600) / 60)).padStart(2, "0");
//       const seconds = String(timeWorkedInSeconds % 60).padStart(2, "0");
//       time_worked = `${hours}:${minutes}:${seconds}`;
//     }

//     // Retrieve FCM tokens.
//     const fcmTokens = fcm_tokens ? fcm_tokens.filter((token) => token) : [];

//     // Send notifications if FCM tokens are available.
//     if (fcmTokens.length > 0) {
//       const multicastMessage = {
//         tokens: fcmTokens,
//         notification: {
//           title: "Click Solver",
//           body: `Commander has completed your work. Great to hear!`,
//         },
//         data: {
//           notification_id: notification_id.toString(),
//           screen: "Paymentscreen",
//         },
//       };

//       try {
//         const response = await getMessaging().sendEachForMulticast(multicastMessage);
//         response.responses.forEach((resItem, index) => {
//           if (!resItem.success) {
//             console.error(`Error sending message to token ${fcmTokens[index]}:`, resItem.error);
//           }
//         });
//       } catch (error) {
//         console.error("Error sending notifications:", error);
//         return res.status(500).json({ error: "Error sending notifications." });
//       }
//     } else {
//       console.error("No FCM tokens to send the message to.");
//       return res.status(200).json({ message: "No FCM tokens to send the message to." });
//     }

//     // Create a background action for the user.
//     const screen = "Paymentscreen";
//     await createUserBackgroundAction(user_id, encodedId, screen, service_booked);
//     await updateWorkerAction(worker_id, encodedId, screen);

//     // Respond with success.
//     return res.status(200).json({
//       notification_id,
//       end_time: updated_end_time,
//       time_worked,
//       updated_time,
//     });
//   } catch (error) {
//     console.error("Error updating end time:", error);
//     return res.status(500).json({ error: "Internal server error." });
//   }
// };

const serviceCompleted = async (req, res) => {
  const { notification_id, encodedId } = req.body;

  if (!notification_id || !encodedId) {
    return res.status(400).json({
      error: "Missing required fields: notification_id and encodedId.",
    });
  }

  try {
    const end_time = new Date();

    // Single query using CTEs, with prev_end_time instead of end_time
    const query = `
      WITH fetched_data AS (
        SELECT
          sc.notification_id,
          sc.start_time,
          sc.end_time      AS prev_end_time,
          a.user_id,
          a.service_booked,
          a.worker_id
        FROM servicecall sc
        JOIN accepted a USING (notification_id)
        WHERE sc.notification_id = $1
        FOR UPDATE
      ),
      check_end_time AS (
        SELECT
          start_time,
          user_id,
          service_booked,
          worker_id,
          (prev_end_time IS NOT NULL) AS is_end_time_set
        FROM fetched_data
      ),
      update_servicecall AS (
        UPDATE servicecall sc
        SET
          end_time   = $2,
          time_worked = 
            TO_CHAR(EXTRACT(EPOCH FROM ($2 - sc.start_time)) / 3600, 'FM00') || ':' ||
            TO_CHAR((EXTRACT(EPOCH FROM ($2 - sc.start_time)) / 60) % 60, 'FM00') || ':' ||
            TO_CHAR(EXTRACT(EPOCH FROM ($2 - sc.start_time)) % 60, 'FM00')
        FROM fetched_data fd
        WHERE sc.notification_id = fd.notification_id
          AND sc.end_time IS NULL
        RETURNING
          sc.end_time    AS updated_end_time,
          sc.time_worked AS updated_time_worked
      ),
      update_accepted AS (
        UPDATE accepted a
        SET
          time = jsonb_set(
            COALESCE(a.time, '{}'::jsonb),
            '{workCompleted}',
            to_jsonb(to_char($2, 'YYYY-MM-DD HH24:MI:SS'))
          )
        FROM fetched_data fd
        WHERE a.notification_id = fd.notification_id
        RETURNING a.time AS updated_time
      ),
      user_fcm AS (
        SELECT ARRAY_AGG(u.fcm_token) AS fcm_tokens
        FROM userfcm u
        WHERE u.user_id = (SELECT user_id FROM fetched_data LIMIT 1)
      )
      SELECT
        cd.start_time,
        cd.user_id,
        cd.service_booked,
        cd.worker_id,
        cd.is_end_time_set,
        us.updated_end_time,
        us.updated_time_worked,
        ua.updated_time,
        uf.fcm_tokens
      FROM check_end_time cd
      LEFT JOIN update_servicecall us ON TRUE
      LEFT JOIN update_accepted ua     ON TRUE
      CROSS JOIN user_fcm uf;
    `;
    const values = [notification_id, end_time];
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found." });
    }

    const {
      start_time,
      user_id,
      service_booked,
      worker_id,
      is_end_time_set,
      updated_end_time,
      updated_time_worked,
      updated_time,
      fcm_tokens
    } = result.rows[0];

    // If already completed
    if (is_end_time_set) {
      return res.status(205).json({ message: "End time already set." });
    }

    // Determine time_worked
    let time_worked = updated_time_worked;
    if (!time_worked) {
      const seconds = Math.floor((end_time - start_time) / 1000);
      const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
      const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
      const secs = String(seconds % 60).padStart(2, '0');
      time_worked = `${hrs}:${mins}:${secs}`;
    }

    // Send FCM notifications
    const tokens = (fcm_tokens || []).filter(t => t);
    if (tokens.length > 0) {
      const multicast = {
        tokens,
        notification: {
          title: "Click Solver",
          body: `Commander has completed your work. Great to hear!`,
        },
        data: {
          notification_id: `${notification_id}`,
          screen: "Paymentscreen",
        },
      };
      try {
        const resp = await getMessaging().sendEachForMulticast(multicast);
        resp.responses.forEach((r, i) => {
          if (!r.success) {
            console.error(`FCM error for ${tokens[i]}:`, r.error);
          }
        });
      } catch (err) {
        console.error("Error sending FCM:", err);
        return res.status(500).json({ error: "Error sending notifications." });
      }
    } else {
      console.warn("No FCM tokens available.");
    }

    // Background actions
    await createUserBackgroundAction(user_id, encodedId, "Paymentscreen", service_booked);
    await updateWorkerAction(worker_id, encodedId, "Paymentscreen");

    // Final response
    return res.status(200).json({
      notification_id,
      end_time: updated_end_time,
      time_worked,
      updated_time,
    });

  } catch (error) {
    console.error("Error updating end time:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};

const getSpecialOffers = async (req, res) => {
  try {
    const result = await client.query(`
      SELECT
        discount_percentage::INT   AS discount_percentage,
        title,
        summary,
        image,
        backgroundColor,
        description
      FROM public.offers
      WHERE summary IS NOT NULL
        AND is_active = true
      ORDER BY discount_percentage DESC
    `);

    return res.status(200).json({
      offers: result.rows
    });
  }
  catch (error) {
    console.error('Error fetching special offers:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
};






   


const stopStopwatch = async (notification_id) => {
  if (stopwatchInterval) {
    clearInterval(stopwatchInterval);
    stopwatchInterval = null;

    try {
      const end_time = new Date(); // Set end_time to the current time

      // SQL query to join servicecall and notifications
      const query = `
        UPDATE servicecall 
        SET end_time = $1 
        WHERE notification_id = $2
        RETURNING (
          SELECT notifications.worker_id 
          FROM notifications 
          WHERE notifications.notification_id = servicecall.notification_id
        ) AS worker_id;
      `;
      const values = [end_time, notification_id];

      const result = await client.query(query, values);

      if (result.rowCount === 0) {
        throw new Error("No service call found with the given notification_id");
      }

      const userIdDetails = await client.query(
        "SELECT user_id FROM notifications WHERE notification_id = $1",
        [notification_id]
      );

      const userId = userIdDetails.rows[0].user_id;

      const fcmTokenResult = await client.query(
        "SELECT fcm_token FROM userfcm WHERE user_id = $1",
        [userId]
      );

      const fcmTokens = fcmTokenResult.rows.map((row) => row.fcm_token);
      // console.log(fcmTokens);

      if (fcmTokens.length > 0) {
        // Create a multicast message object for all tokens
        const multicastMessage = {
          tokens: fcmTokens, // An array of tokens to send the same message to
          notification: {
            title: "Click Solver",
            body: `Commander has completed your work. Great to hear!`,
          },
          data: {
            user_notification_id: notification_id.toString(),
          },
        };

        try {
          // Use sendEachForMulticast to send the same message to multiple tokens
          const response = await getMessaging().sendEachForMulticast(
            multicastMessage
          );

          // Log the responses for each token
          response.responses.forEach((res, index) => {
            if (res.success) {
              // console.log(`Message sent successfully to token ${fcmTokens[index]}`);
            } else {
              console.error(
                `Error sending message to token ${fcmTokens[index]}:`,
                res.error
              );
            }
          });

          // console.log('Success Count:', response.successCount);
          // console.log('Failure Count:', response.failureCount);
        } catch (error) {
          console.error("Error sending notifications:", error);
        }
      } else {
        console.error("No FCM tokens to send the message to.");
      }

      return result.rows[0].worker_id; // Return worker_id from the joined table
    } catch (error) {
      console.error("Error updating end_time:", error);
      throw new Error("Internal server error");
    }
  } else {
    throw new Error("Stopwatch is not running");
  }
};

const updateWorkerLifeDetails = async (workerId, totalAmount) => {
  try {
    // Ensure totalAmount is an integer
    const integerAmount = Math.round(totalAmount); // Use Math.floor(totalAmount) to truncate instead

    const query = `
      UPDATE workerlife
      SET 
        money_earned = money_earned + $1,
        service_counts = service_counts + 1
      WHERE worker_id = $2
      RETURNING money_earned, service_counts;
    `;
    const values = [integerAmount, workerId];

    const result = await client.query(query, values);

    if (result.rowCount === 0) {
      throw new Error("No worker found with the given worker_id");
    }

    return result.rows[0];
  } catch (error) {
    console.error("Error updating workerlife details:", error);
    throw new Error("Internal server error");
  }
};

// Controller function to handle storing user location
const storeUserLocation = async (req, res) => {
  let { longitude, latitude } = req.body;

  const userId = req.user.id;
  // Log the received data

  try {
    const query = `
      INSERT INTO userLocation (longitude, latitude, user_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id)
      DO UPDATE SET longitude = EXCLUDED.longitude, latitude = EXCLUDED.latitude
    `;
    await client.query(query, [longitude, latitude, userId]);

    res.status(200).json({ message: "User location stored successfully" });
  } catch (error) {
    console.error("Error storing user location:", error);
    res.status(500).json({ error: "Failed to store user location" });
  }
};

const skillWorkerRegistration = async (req, res) => {
  const workerId = req.worker.id;
  const { selectedService, checkedServices, profilePic, proofPic, agree } =
    req.body;
  try {
    const query = `
      INSERT INTO workerskills (worker_id, service, subservices, profile, proof, agree)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (worker_id) DO UPDATE
      SET service = EXCLUDED.service, subservices = EXCLUDED.subservices, profile = EXCLUDED.profile, proof = EXCLUDED.proof, agree = EXCLUDED.agree
    `;
    await client.query(query, [
      workerId,
      selectedService,
      checkedServices,
      profilePic,
      proofPic,
      agree,
    ]);

    const workerLife = `
    INSERT INTO workerlife (worker_id, service_counts, money_earned)
    VALUES ($1, $2, $3)
    ON CONFLICT (worker_id) DO UPDATE
    SET service_counts = 0, money_earned = 0
  `;
    await client.query(workerLife, [workerId, 0, 0]);
    res
      .status(200)
      .json({ message: "Skilled worker registration stored successfully" });
  } catch (error) {
    console.error("Error storing user location:", error);
    res
      .status(500)
      .json({ error: "Failed to store Skilled worker registration" });
  }
};

const workerLifeDetails = async (req, res) => {
  const workerId = req.worker.id;

  try {
    const result = await client.query(
      `
        SELECT 
          wl.service_counts, 
          wl.money_earned, 
          wl.average_rating, 
          ws.profile,
          un.area,
          un.city,
          un.pincode,
          n.notification_id,
          sc.time_worked,
          u.name AS user_name,
          f.name AS feedback_name,
          f.rating AS feedback_rating,
          f.comment,
          f.created_at,
          (SELECT AVG(rating) FROM feedback WHERE worker_id = $1) AS average_rating
        FROM workerlife wl
        INNER JOIN workerskills ws ON wl.worker_id = ws.worker_id
        INNER JOIN servicecall sc ON wl.worker_id = sc.worker_id
        INNER JOIN notifications n ON sc.notification_id = n.notification_id
        INNER JOIN usernotifications un ON n.user_notification_id = un.user_notification_id
        INNER JOIN "user" u ON n.user_id = u.user_id
        INNER JOIN feedback f ON n.notification_id = f.notification_id
        WHERE wl.worker_id = $1
        ORDER BY n.notification_id DESC
        LIMIT 5
      `,
      [workerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }

    const workerProfile = {
      profileDetails: result.rows,
      workerId,
    };

    // Since the average_rating is included in each row, you can take it from the first result.
    workerProfile.averageRating = result.rows[0].average_rating;

    return res.status(200).json(workerProfile);
  } catch (error) {
    console.error("Error getting worker life details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const workerProfileDetails = async (req, res) => {
  const workerId = req.worker.id;

  try {
    const profileResult = await client.query(
      `
        SELECT 
          w.name AS worker_name, 
          w.created_at, 
          ws.profile, 
          ws.service, 
          ws.subservices,
          f.name AS feedback_name,
          f.rating,
          f.comment,
          (SELECT AVG(rating) FROM feedback WHERE worker_id = $1) AS average_rating
        FROM workersverified w
        INNER JOIN workerskills ws ON w.worker_id = ws.worker_id
        LEFT JOIN feedback f ON w.worker_id = f.worker_id
        WHERE w.worker_id = $1
      `,
      [workerId]
    );

    if (profileResult.rows.length === 0) {
      return res.status(404).json({ error: "Worker profile not found" });
    }

    // Extract average rating from the result
    const averageRating = profileResult.rows[0].average_rating;

    const workerProfile = {
      profileDetails: profileResult.rows,
      averageRating,
    };

    return res.status(200).json(workerProfile);
  } catch (error) {
    console.error("Error getting worker profile details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getWorkerNavigationDetails = async (req, res) => {
  const { notificationId } = req.body;

  if (!notificationId) {
    return res.status(400).json({ error: "Notification ID is required" });
  }

  try {
    // Query to fetch worker_id, pin from notifications and name, phone_number from workersverified using JOIN
    const query = `
    SELECT 
      n.pin, 
      n.service_booked,
      w.name, 
      w.phone_number,
      un.area,
      ws.profile,
      wl.average_rating, -- Fetch average rating from workerlife
      wl.service_counts  -- Fetch service counts from workerlife
    FROM 
      accepted n
    JOIN 
      workersverified w ON n.worker_id = w.worker_id
    JOIN 
      usernotifications un ON n.user_notification_id = un.user_notification_id
    JOIN 
      workerskills ws ON n.worker_id = ws.worker_id
    JOIN 
      workerlife wl ON n.worker_id = wl.worker_id -- Joining workerlife table to get ratings and service counts
    WHERE 
      n.notification_id = $1;
  `;
  

    const result = await client.query(query, [notificationId]);

    // If no results, return 404
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Notification or worker not found" });
    }

    const {
      pin,
      name,
      phone_number,
      profile,
      pincode,
      area,
      city,
      service_booked,
      average_rating,
      service_counts

    } = result.rows[0];

    // Send the response
    return res.status(200).json({
      pin,
      name,
      phone_number,
      profile,
      pincode,
      area,
      city,
      service_booked,
      average_rating,
      service_counts
    });
  } catch (error) {
    console.error("Error getting worker navigation details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const registrationStatus = async (req, res) => {
  const workerId = req.worker.id;

  try {
    const result = await client.query(
      "SELECT skill_id FROM workerskills WHERE worker_id = $1",
      [workerId]
    );
    // console.log(result.rows.length)
    if (result.rows.length === 0) {
      return res.status(204).json({ message: "worker not found" });
    } else {
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error("Error updating skill registration:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const subservices = async (req, res) => {
  const { selectedService } = req.body;
  console.log(selectedService)
  try {
    const result = await client.query(
      `SELECT 
            asv.service_tag,
            asv.main_service_id,
            rs.service_category,
            s.service_id
        FROM  
            servicecategories sc
        JOIN 
            relatedservices rs ON sc.service_name = rs.service 
        JOIN 
            allservices asv ON asv.service_category = rs.service_category
        JOIN
            services s ON s.service_name = rs.service_category
        WHERE 
            sc.service_name = $1;
        `,
      [selectedService]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "worker not found" });
    } else {
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error("Error updating skill registration:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const userUpdateLastLogin = async (req, res) => {
  const userId = req.worker.id;
  const time = getCurrentTimestamp();
  try {
    const query = {
      text: `UPDATE "user" SET last_active = $1 WHERE user_id = $2 RETURNING *`,
      values: [time, userId],
    };

    const result = await client.query(query);
    return result.rows[0];
  } catch (error) {
    console.error(error);
    throw error;
  }
};

const checkInactiveUsers = async () => {
  // Adjust time to filter inactive users
  const oneMinuteAgo = new Date(Date.now() - 1 * 60 * 1000);

  const query = {
    text: `
      SELECT u.*, ft.fcm_token
      FROM "user" u
      JOIN userfcm ft ON u.user_id = ft.user_id
      WHERE u.last_active < $1
    `,
    values: [oneMinuteAgo],
  };

  try {
    const result = await client.query(query);

    result.rows.forEach(async (user) => {
      const message = {
        notification: {
          title: "We Miss You!",
          body: "It’s been a while since you last visited us. Come back and check out what’s new!",
        },
        token: user.fcm_token,
      };

      try {
        // Send notification using FCM
        const response = await getMessaging().send(message);
        console.log(
          `Notification sent successfully to user_id: ${user.user_id}`,
          response
        );
      } catch (error) {
        // Handle FCM messaging errors
        if (error.code === "messaging/registration-token-not-registered") {
          console.error(
            `Invalid token for user_id: ${user.user_id}. Removing token...`
          );
          // Remove the invalid token from the database
          const deleteQuery = {
            text: "DELETE FROM userfcm WHERE fcm_token = $1",
            values: [user.fcm_token],
          };
          await client.query(deleteQuery);
        } else {
          console.error(
            `Error sending notification to user_id: ${user.user_id}`,
            error
          );
        }
      }
    });
  } catch (dbError) {
    console.error("Database query error:", dbError);
  }
};

cron.schedule("0 9 * * *", () => {
  console.log("Running checkInactiveUsers notification job at 9 AM IST...");
  checkInactiveUsers();
}, {
  timezone: "Asia/Kolkata"
});

// Function to run the DELETE query
const deleteOldUserNotifications = async () => {
  const query = `
    DELETE FROM usernotifications
    WHERE user_notification_id NOT IN (
        SELECT user_notification_id FROM accepted
        UNION
        SELECT user_notification_id FROM completenotifications
        UNION
        SELECT user_notification_id FROM notifications
    );
  `;

  try {
    await client.query(query);
    console.log("Old user notifications deleted successfully.");
  } catch (err) {
    console.error("Error deleting old user notifications:", err.message);
  }
};

cron.schedule("0 2 * * *", () => {
  console.log("Running deleteOldUserNotifications notification job at 9 AM IST...");
  deleteOldUserNotifications();
}, {
  timezone: "Asia/Kolkata"
});

// ***
const cancelRequest = async (req, res) => {
  const { user_notification_id } = req.body;

  if (!user_notification_id) {
    return res.status(400).json({ error: "user_notification_id is required" });
  }

  try {
    // Combined query to check both 'accept' status and 'cancel_status'
    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'accept') AS accept_count,
        MAX(cancel_status) AS cancel_status
      FROM 
        notifications 
      WHERE 
        user_notification_id = $1
    `;

    const result = await client.query(query, [user_notification_id]);

    const acceptCount = parseInt(result.rows[0].accept_count, 10);
    const currentStatus = result.rows[0].cancel_status;

    // Check if there is an 'accept' status
    if (acceptCount > 0) {
      return res
        .status(400)
        .json({ error: "Cannot cancel as status is already accepted" });
    }

    // Only update if the current cancel_status is not 'timeup'
    if (currentStatus !== "timeup") {
      await client.query(
        "UPDATE notifications SET cancel_status = $1 WHERE user_notification_id = $2",
        ["cancel", user_notification_id]
      );
      return res
        .status(200)
        .json({ message: "Cancel status updated to cancel" });
    } else {
      return res
        .status(400)
        .json({ error: "Cannot update status as it is already timeup" });
    }
  } catch (error) {
    console.error("Error updating cancel status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Function to verify OTP
const verifyOTP = async (req, res) => {
  const { verificationCode } = req.body;
  // console.log(verificationCode)
  try {
    const sessionInfo = await admin.auth().verifyIdToken(verificationCode);

    res.status(200).send({ success: true, sessionInfo });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).send({ success: false, error: error.message });
  }
};

const calculatePayment = (timeWorked) => {
  const [hours, minutes, seconds] = timeWorked.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes;

  if (totalMinutes <= 30) {
    return 149;
  }

  const extraMinutes = totalMinutes - 30;
  const fullHalfHours = Math.floor(extraMinutes / 30);
  const remainingMinutes = extraMinutes % 30;

  let extraCharges = fullHalfHours * 49;
  if (remainingMinutes > 0) {
    const remainingCharge = Math.min(remainingMinutes * 5, 49);
    extraCharges += remainingCharge;
  }

  return 149 + extraCharges;
};

// Function to get service call details by notification_id
const paymentDetails = async (notification_id) => {
  try {
    const query = "SELECT * FROM servicecall WHERE notification_id = $1";
    const values = [notification_id];

    const res = await client.query(query, values);

    if (res.rows.length > 0) {
      return res.rows[0];
    } else {
      throw new Error("No service call found with the given notification_id");
    }
  } catch (error) {
    console.error("Error fetching service call details:", error);
    throw error;
  }
};

const getPaymentDetails = async (notification_id) => {
  // console.log(notification_id)
  try {
    const query = `
      SELECT 
        n.service,
        n.discount,
        n.total_cost,
        u.name 
      FROM 
        accepted n
      JOIN 
        "user" u ON n.user_id = u.user_id 
      WHERE 
        n.notification_id = $1
    `;
    const values = [notification_id];

    const res = await client.query(query, values);

    if (res.rows.length > 0) {
      // console.log(res.rows[0])
      return res.rows[0];
    } else {
      throw new Error(
        "No service payment details found with the given notification_id"
      );
    }
  } catch (error) {
    console.error("Error fetching payment details details:", error);
    throw error;
  }
};

// const processPayment = async (req, res) => {
//   const { totalAmount, paymentMethod, decodedId } = req.body;

//   if (!paymentMethod || !decodedId) {
//     return res.status(402).json({
//       error: "Missing required fields: totalAmount, paymentMethod, and decodedId.",
//     });
//   }

//   try {
//     const end_time = new Date();

//     // 1) Update servicecall, update accepted, upsert workerlife, insert into completenotifications, fetch FCM
//     const combinedQuery = `
//       WITH update_servicecall AS (
//         UPDATE servicecall
//         SET payment = $1,
//             payment_type = $2,
//             end_time = NOW()
//         WHERE notification_id = $3
//         RETURNING notification_id
//       ),
//       update_accepted AS (
//         UPDATE accepted a
//         SET
//           time = jsonb_set(
//             COALESCE(a.time, '{}'::jsonb),
//             '{paymentCompleted}',
//             to_jsonb(to_char($4::timestamp, 'YYYY-MM-DD HH24:MI:SS'))
//           )
//         FROM update_servicecall us
//         WHERE a.notification_id = us.notification_id
//         RETURNING
//           a.user_id,
//           a.service_booked,
//           a.worker_id,
//           a.accepted_id,
//           a.notification_id,
//           a.user_notification_id,
//           a.longitude,
//           a.latitude,
//           a.time,
//           a.discount,
//           a.total_cost,
//           a.tip_amount
//       ),
//       upsert_workerlife AS (
//         INSERT INTO workerlife (
//           worker_id,
//           service_counts,
//           money_earned,
//           balance_amount,
//           cashback_approved_times
//         )
//         SELECT
//           ua.worker_id,
//           1,
//           $6,
//           CASE WHEN $5 = 'cash' THEN -($6 * 0.12) ELSE ($6 * 0.88) END,
//           0
//         FROM update_accepted ua
//         ON CONFLICT (worker_id) DO UPDATE
//           SET
//             service_counts         = workerlife.service_counts + 1,
//             money_earned           = workerlife.money_earned + EXCLUDED.money_earned,
//             balance_amount         = CASE
//                                        WHEN $5 = 'cash'
//                                          THEN workerlife.balance_amount - ($6 * 0.12)
//                                        ELSE workerlife.balance_amount + ($6 * 0.88)
//                                      END,
//             cashback_approved_times = FLOOR((workerlife.service_counts + 1) / 6)
//         RETURNING balance_amount
//       ),
//       insert_completenotifications AS (
//         INSERT INTO completenotifications (
//           accepted_id,
//           notification_id,
//           user_id,
//           user_notification_id,
//           service_booked,
//           longitude,
//           latitude,
//           worker_id,
//           time,
//           discount,
//           total_cost,
//           tip_amount
//         )
//         SELECT
//           ua.accepted_id,
//           ua.notification_id,
//           ua.user_id,
//           ua.user_notification_id,
//           ua.service_booked,
//           ua.longitude,
//           ua.latitude,
//           ua.worker_id,
//           ua.time,
//           ua.discount,
//           ua.total_cost,
//           ua.tip_amount
//         FROM update_accepted ua
//         RETURNING notification_id
//       ),
//       get_user_fcms AS (
//         SELECT
//           ua.user_id,
//           COALESCE(array_agg(uf.fcm_token), '{}') AS user_fcm_tokens
//         FROM update_accepted ua
//         LEFT JOIN userfcm uf ON uf.user_id = ua.user_id
//         GROUP BY ua.user_id
//       )
//       SELECT
//         ua.user_id,
//         ua.service_booked,
//         ua.worker_id,
//         uw.balance_amount AS final_balance,
//         gf.user_fcm_tokens
//       FROM update_accepted ua
//       JOIN upsert_workerlife uw ON TRUE
//       LEFT JOIN get_user_fcms gf ON gf.user_id = ua.user_id;
//     `;

//     const values = [
//       totalAmount,   // $1
//       paymentMethod, // $2
//       decodedId,     // $3
//       end_time,      // $4
//       paymentMethod, // $5 for workerlife logic
//       totalAmount,   // $6 for workerlife logic
//     ];

//     const combinedResult = await client.query(combinedQuery, values);
//     if (combinedResult.rows.length === 0) {
//       return res.status(404).json({ error: "Notification not found." });
//     }

//     // 2) Delete the original accepted row
//     await client.query(
//       `DELETE FROM accepted WHERE notification_id = $1;`,
//       [decodedId]
//     );

//     const {
//       user_id,
//       service_booked,
//       worker_id,
//       final_balance,
//       user_fcm_tokens,
//     } = combinedResult.rows[0];

//     // 3) Background actions
//     const encodedNotificationId = Buffer.from(decodedId.toString()).toString("base64");
//     await createUserBackgroundAction(user_id, encodedNotificationId, "", service_booked);
//     await updateWorkerAction(worker_id, encodedNotificationId, "");

//     // 4) Notify user
//     if (user_fcm_tokens.length) {
//       await admin.messaging().sendEachForMulticast({
//         tokens: user_fcm_tokens,
//         notification: {
//           title: "Payment Confirmation",
//           body: `Payment of ${totalAmount} completed! New balance is ${final_balance}.`,
//         },
//         data: {
//           notification_id: decodedId.toString(),
//           type: "PAYMENT_CONFIRMATION",
//           screen: "Home",
//         },
//       });
//     }

//     return res.status(200).json({ message: "Payment processed successfully" });
//   } catch (error) {
//     console.error("Error processing payment:", error);
//     return res.status(500).json({ error: "Error while processing payment." });
//   }
// };

const processPayment = async (req, res) => {
  const { totalAmount, paymentMethod, decodedId } = req.body;

  if (!paymentMethod || !decodedId) {
    return res.status(402).json({
      error: "Missing required fields: totalAmount, paymentMethod, and decodedId.",
    });
  }

  try {
    const end_time = new Date();

    const combinedQuery = `
      WITH update_servicecall AS (
        UPDATE servicecall
        SET payment = $1,
            payment_type = $2,
            end_time = NOW()
        WHERE notification_id = $3
        RETURNING notification_id
      ),
      update_accepted AS (
        UPDATE accepted a
        SET
          time = jsonb_set(
            COALESCE(a.time, '{}'::jsonb),
            '{paymentCompleted}',
            to_jsonb(to_char($4::timestamp, 'YYYY-MM-DD HH24:MI:SS'))
          )
        FROM update_servicecall us
        WHERE a.notification_id = us.notification_id
        RETURNING
          a.user_id,
          a.service_booked,
          a.worker_id,
          a.accepted_id,
          a.notification_id,
          a.user_notification_id,
          a.longitude,
          a.latitude,
          a.time,
          a.discount,
          a.total_cost,
          a.tip_amount
      ),
      upsert_workerlife AS (
        INSERT INTO workerlife (
          worker_id,
          service_counts,
          money_earned,
          balance_amount,
          cashback_approved_times
        )
        SELECT
          ua.worker_id,
          1,
          $6,
          -- For the first 15 services, start balance at 0
          0,
          0
        FROM update_accepted ua
        ON CONFLICT (worker_id) DO UPDATE
          SET
            service_counts         = workerlife.service_counts + 1,
            money_earned           = workerlife.money_earned + EXCLUDED.money_earned,
            balance_amount         = CASE
                                       -- If new total count ≤ 15, leave balance unchanged
                                       WHEN (workerlife.service_counts + 1) <= 15
                                         THEN workerlife.balance_amount
                                       -- After 15 services, apply commission/share logic
                                       WHEN $5 = 'cash'
                                         THEN workerlife.balance_amount - ($6 * 0.12)
                                       ELSE
                                         workerlife.balance_amount + ($6 * 0.88)
                                     END,
            cashback_approved_times = CASE
                                       -- Award cashback only once when crossing from 5 → 6 services
                                       WHEN workerlife.service_counts < 6
                                            AND (workerlife.service_counts + 1) = 6
                                         THEN 1
                                       ELSE workerlife.cashback_approved_times
                                     END
        RETURNING balance_amount
      ),
      insert_completenotifications AS (
        INSERT INTO completenotifications (
          accepted_id,
          notification_id,
          user_id,
          user_notification_id,
          service_booked,
          longitude,
          latitude,
          worker_id,
          time,
          discount,
          total_cost,
          tip_amount
        )
        SELECT
          ua.accepted_id,
          ua.notification_id,
          ua.user_id,
          ua.user_notification_id,
          ua.service_booked,
          ua.longitude,
          ua.latitude,
          ua.worker_id,
          ua.time,
          ua.discount,
          ua.total_cost,
          ua.tip_amount
        FROM update_accepted ua
        RETURNING notification_id
      ),
      get_user_fcms AS (
        SELECT
          ua.user_id,
          COALESCE(array_agg(uf.fcm_token), '{}') AS user_fcm_tokens
        FROM update_accepted ua
        LEFT JOIN userfcm uf ON uf.user_id = ua.user_id
        GROUP BY ua.user_id
      )
      SELECT
        ua.user_id,
        ua.service_booked,
        ua.worker_id,
        uw.balance_amount AS final_balance,
        gf.user_fcm_tokens
      FROM update_accepted ua
      JOIN upsert_workerlife uw ON TRUE
      LEFT JOIN get_user_fcms gf ON gf.user_id = ua.user_id;
    `;

    const values = [
      totalAmount,   // $1: payment
      paymentMethod, // $2: payment_type
      decodedId,     // $3: notification_id
      end_time,      // $4: timestamp
      paymentMethod, // $5: for workerlife logic (cash vs non-cash)
      totalAmount,   // $6: money earned
    ];

    const combinedResult = await client.query(combinedQuery, values);
    if (combinedResult.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found." });
    }

    // Remove the processed accepted row
    await client.query(
      `DELETE FROM accepted WHERE notification_id = $1;`,
      [decodedId]
    );

    const {
      user_id,
      service_booked,
      worker_id,
      final_balance,
      user_fcm_tokens,
    } = combinedResult.rows[0];

    // Background actions
    const encodedNotificationId = Buffer.from(decodedId.toString()).toString("base64");
    await createUserBackgroundAction(user_id, encodedNotificationId, "", service_booked);
    await updateWorkerAction(worker_id, encodedNotificationId, "");

    // Send FCM to the user
    if (user_fcm_tokens.length) {
      await admin.messaging().sendEachForMulticast({
        tokens: user_fcm_tokens,
        notification: {
          title: "Payment Confirmation",
          body: `Payment of ${totalAmount} completed! New balance is ${final_balance}.`,
        },
        data: {
          notification_id: decodedId.toString(),
          type: "PAYMENT_CONFIRMATION",
          screen: "Home",
        },
      });
    }

    return res.status(200).json({ message: "Payment processed successfully" });
  } catch (error) {
    console.error("Error processing payment:", error);
    return res.status(500).json({ error: "Error while processing payment." });
  }
};

const submitFeedback = async (req, res) => {
  try {
    // Convert and validate inputs
    const rawNotificationId = req.body.notification_id;
    const rawRating = req.body.rating;
    const rawUserId = req.user.id;
    
    // Convert to numbers and check for validity
    const notification_id = parseInt(rawNotificationId, 10);
    const rating = parseInt(rawRating, 10);
    const user_id = parseInt(rawUserId, 10);
    
    if (isNaN(notification_id) || isNaN(rating) || isNaN(user_id)) {
      return res.status(400).json({
        message: "Notification ID, rating, and user ID must be valid numbers.",
      });
    }

    // Using CTE to insert feedback and update worker's ratings count & average rating
    const query = `
      WITH inserted_feedback AS (
        INSERT INTO feedback (notification_id, rating, comment, user_id, worker_id, name)
        VALUES (
          $1,
          $2,
          $3,
          $4,
          (SELECT worker_id FROM completenotifications WHERE notification_id = $1),
          (SELECT name FROM "user" WHERE user_id = $4)
        )
        RETURNING worker_id, rating
      ),
      updated_worker AS (
        UPDATE workerlife
        SET 
          ratings_count = ratings_count + 1,
          average_rating = ((average_rating::numeric * ratings_count) + (SELECT rating::numeric FROM inserted_feedback)) / (ratings_count + 1)
        WHERE worker_id = (SELECT worker_id FROM inserted_feedback)
        RETURNING worker_id, ratings_count, average_rating
      )
      SELECT * FROM updated_worker;
    `;

    const values = [notification_id, rating, req.body.comment || null, user_id];
    const result = await client.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Worker ID not found or update failed." });
    }

    res.status(201).json({
      message: "Feedback submitted and rating updated successfully.",
      feedback: {
        worker_id: result.rows[0].worker_id,
        ratings_count: result.rows[0].ratings_count,
        average_rating: Number(result.rows[0].average_rating).toFixed(2)
      },
    });
  } catch (error) {
    // If duplicate key error occurs, send a conflict response.
    if (error.code === '23505') {
      return res.status(409).json({
        message: "Feedback already submitted for this notification."
      });
    }
    console.error("Error submitting feedback:", error);
    res.status(500).json({ message: "Internal server error.", error: error.message });
  }
};

const sendSMSVerification = async (req, res) => {
  const { phoneNumber } = req.body;

  // Generate a random 6-digit verification code
  const verificationCode = Math.floor(100000 + Math.random() * 900000);
  const message = `Your verification code is ${verificationCode}`;

  const authString = Buffer.from(`${customerId}:${apiKey}`).toString("base64");

  try {
    // Send SMS using Telesign API
    const response = await axios.post(
      smsEndpoint,
      {
        phone_number: phoneNumber,
        message: message,
        message_type: "OTP",
      },
      {
        headers: {
          Authorization: `Basic ${authString}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    // On success, return the verification code (for testing purposes)
    res.status(200).json({ success: true, verificationCode });
  } catch (error) {
    // On failure, log and return the error
    console.error(
      "Error sending SMS:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ success: false, message: "Error sending SMS" });
  }
};

const workerDetails = async (req, res, notification_id) => {
  try {
    // Combine queries using JOIN
    const query = `
      SELECT 
        w.name AS worker_name, 
        u.service AS service 
      FROM 
        accepted n
      JOIN 
        workersverified w ON n.worker_id = w.worker_id
      JOIN 
        usernotifications u ON n.user_notification_id = u.user_notification_id
      WHERE 
        n.notification_id = $1
    `;

    const result = await client.query(query, [notification_id]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Notification or related data not found" });
    }

    const { worker_name, service } = result.rows[0];

    // Return the worker's name and service
    res.json({ name: worker_name, service });
  } catch (error) {
    console.error("Error checking worker details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getServiceCompletedDetails = async (req, res) => {
  const { notification_id } = req.body;
  console.log("notification",notification_id)

  try {
    const query = `
      SELECT 
          sc.payment, 
          sc.payment_type, 
          cn.service_booked, 
          cn.longitude, 
          cn.latitude, 
          un.area, 
          u.name
      FROM completenotifications cn
      JOIN servicecall sc ON cn.notification_id = sc.notification_id
      JOIN usernotifications un ON cn.user_notification_id = un.user_notification_id
      JOIN "user" u ON un.user_id = u.user_id
      WHERE cn.notification_id = $1;
    `;

    const result = await client.query(query, [notification_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification or related data not found" });
    }

    const { payment, payment_type, service_booked, longitude, latitude, area, name } = result.rows[0];
    const jsonbServiceBooked =
      typeof service_booked === "object"
        ? JSON.stringify(service_booked)
        : service_booked;

    return res.json({
      message: "Service completed and data shifted successfully",
      payment,
      payment_type,
      service: jsonbServiceBooked,
      longitude,
      latitude,
      area,
      name,
    });
  } catch (error) {
    console.error("Error checking worker details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

function convertToDateString(isoDate) {
  if (!isoDate) {
    // Handle case where isoDate is null or undefined
    return null;
  }

  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    // Handle invalid date format
    return null;
  }

  // Extract year, month, day, hours, minutes, seconds, and milliseconds
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Month is zero-based
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  // Return the formatted date string
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// const getWorkerEarnings = async (req, res) => {
//   const { date, startDate, endDate } = req.body;
//   const workerId = req.worker.id;

//   let selectStartDate;
//   let selectEndDate;

//   if (startDate && endDate) {
//     selectStartDate = convertToDateString(startDate);
//     selectEndDate = convertToDateString(endDate);

//     if (!selectStartDate || !selectEndDate) {
//       return res
//         .status(400)
//         .json({ error: "Invalid startDate or endDate format" });
//     }
//     if (new Date(selectStartDate) > new Date(selectEndDate)) {
//       return res
//         .status(400)
//         .json({ error: "startDate cannot be after endDate" });
//     }
//   } else if (date) {
//     selectStartDate = convertToDateString(date);
//     selectEndDate = selectStartDate;

//     if (!selectStartDate) {
//       return res.status(400).json({ error: "Invalid date format" });
//     }
//   } else {
//     return res.status(400).json({ error: "No date provided" });
//   }

//   try {
//     const query = `
//         SELECT
//           SUM(payment) AS total_payment,
//           SUM(CASE WHEN payment_type = 'cash' THEN payment ELSE 0 END) AS cash_payment,
//           COUNT(*) AS payment_count,
//           (SELECT SUM(payment)
//             FROM servicecall
//             WHERE worker_id = $1
//               AND payment IS NOT NULL
//           ) AS life_earnings,
//           (SELECT average_rating
//             FROM workerlife
//             WHERE worker_id = $1
//           ) AS avg_rating,
//           (SELECT COUNT(*)
//             FROM completenotifications
//             WHERE worker_id = $1
//               AND complete_status = 'workercanceled'
//               AND DATE(created_at) BETWEEN DATE($2) AND DATE($3)
//           ) AS rejected_count,
//           (SELECT COUNT(*)
//             FROM notifications
//             WHERE worker_id = $1
//               AND status = 'pending'
//               AND DATE(created_at) BETWEEN DATE($2) AND DATE($3)
//           ) AS pending_count,
//           (EXTRACT(EPOCH FROM SUM(
//               CASE
//                   WHEN time_worked ~ '^\d{2}:\d{2}:\d{2}$'
//                       AND CAST(split_part(time_worked, ':', 2) AS INTEGER) < 60
//                       AND CAST(split_part(time_worked, ':', 3) AS INTEGER) < 60
//                   THEN CAST(time_worked AS INTERVAL)
//                   ELSE INTERVAL '0'
//               END
//           )) / 3600) AS total_time_worked_hours,
//           (SELECT service_counts FROM workerlife WHERE worker_id = $1) AS service_counts,
//           (SELECT cashback_approved_times FROM workerlife WHERE worker_id = $1) AS cashback_approved_times,
//           (SELECT cashback_gain FROM workerlife WHERE worker_id = $1) AS cashback_gain
//         FROM servicecall s
//         WHERE worker_id = $1
//           AND payment IS NOT NULL
//           AND DATE(end_time) BETWEEN DATE($2) AND DATE($3);
//         `;

//     const result = await client.query(query, [
//       workerId,
//       selectStartDate,
//       selectEndDate,
//     ]);

//     console.log(result.rows[0])

//     if (result.rows.length === 0) {
//       return res.status(404).json({ error: "No earnings data found" });
//     }

//     const {
//       total_payment,
//       cash_payment,
//       payment_count,
//       life_earnings,
//       avg_rating,
//       rejected_count,
//       pending_count,
//       total_time_worked_hours,
//       service_counts,
//       cashback_approved_times,
//       cashback_gain,
//     } = result.rows[0];

//     console.log("rej",rejected_count)
 
//     res.json({
//       total_payment: Number(total_payment) || 0,
//       cash_payment: Number(cash_payment) || 0,
//       payment_count: Number(payment_count) || 0,
//       life_earnings: Number(life_earnings) || 0,
//       avg_rating: Number(avg_rating) || 0,
//       rejected_count: Number(rejected_count) || 0,
//       pending_count: Number(pending_count) || 0,
//       total_time_worked_hours: Number(total_time_worked_hours) || 0,
//       service_counts: Number(service_counts) || 0,
//       cashback_approved_times: Number(cashback_approved_times) || 0,
//       cashback_gain: Number(cashback_gain) || 0,
//     });
//   } catch (error) {
//     console.error("Error fetching worker earnings:", error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// };

const getWorkerEarnings = async (req, res) => {
  const { date, startDate, endDate } = req.body;
  const workerId = req.worker.id;

  let selectStartDate, selectEndDate;

  // 1) Parse incoming dates
  if (startDate && endDate) {
    selectStartDate = convertToDateString(startDate);
    selectEndDate   = convertToDateString(endDate);

    if (!selectStartDate || !selectEndDate) {
      console.log("❌ Invalid start/end format:", startDate, endDate);
      return res.status(400).json({ error: "Invalid startDate or endDate format" });
    }
    if (new Date(selectStartDate) > new Date(selectEndDate)) {
      console.log("❌ startDate > endDate:", selectStartDate, selectEndDate);
      return res.status(400).json({ error: "startDate cannot be after endDate" });
    }
  } else if (date) {
    selectStartDate = convertToDateString(date);
    selectEndDate   = selectStartDate;
    if (!selectStartDate) {
      console.log("❌ Invalid single date:", date);
      return res.status(400).json({ error: "Invalid date format" });
    }
  } else {
    console.log("❌ No date provided in request");
    return res.status(400).json({ error: "No date provided" });
  }

  // 2) Trim to YYYY-MM-DD only
  const start = selectStartDate.slice(0, 10);
  const end   = selectEndDate.slice(0, 10);

  console.log("🕵️ getWorkerEarnings params:", { workerId, start, end });

  try {
    const query = `
      SELECT
        COALESCE(sc.total_payment,0)           AS total_payment,
        COALESCE(sc.cash_payment,0)            AS cash_payment,
        COALESCE(sc.payment_count,0)           AS payment_count,
        COALESCE(sc.total_time_worked_hours,0) AS total_time_worked_hours,
        sc.life_earnings,

        wl.average_rating                     AS avg_rating,

        COALESCE(cn.rejected_count,0)         AS rejected_count,
        COALESCE(pn.pending_count,0)          AS pending_count,

        wl.service_counts,
        wl.cashback_approved_times,
        wl.cashback_gain

      FROM workerlife wl

      LEFT JOIN LATERAL (
        SELECT
          SUM(s.payment)                                     AS total_payment,
          SUM(CASE WHEN s.payment_type='cash' THEN s.payment ELSE 0 END)
                                                             AS cash_payment,
          COUNT(*)                                           AS payment_count,
          (EXTRACT(
             EPOCH FROM SUM(
               CASE
                 WHEN s.time_worked ~ '^\\d{2}:\\d{2}:\\d{2}$'
                   AND split_part(s.time_worked, ':', 2)::int < 60
                   AND split_part(s.time_worked, ':', 3)::int < 60
                 THEN s.time_worked::interval
                 ELSE INTERVAL '0'
               END
             )
           ) / 3600)                                          AS total_time_worked_hours,
          (SELECT COALESCE(SUM(payment),0)
             FROM servicecall
            WHERE worker_id = wl.worker_id
              AND payment IS NOT NULL
          )                                                   AS life_earnings
        FROM servicecall s
        WHERE s.worker_id = wl.worker_id
          AND s.payment    IS NOT NULL
          AND DATE(s.end_time) BETWEEN DATE($2) AND DATE($3)
      ) sc ON TRUE

      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS rejected_count
        FROM completenotifications cn
        WHERE cn.worker_id       = wl.worker_id
          AND cn.complete_status = 'workercanceled'
          AND DATE(cn.created_at) BETWEEN DATE($2) AND DATE($3)
      ) cn ON TRUE

      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS pending_count
        FROM notifications n
        WHERE n.worker_id = wl.worker_id
          AND n.status    = 'pending'
          AND DATE(n.created_at) BETWEEN DATE($2) AND DATE($3)
      ) pn ON TRUE

      WHERE wl.worker_id = $1;
    `;

    const values = [workerId, start, end];
    console.log("🛠️ Executing SQL with values:", values);

    const { rows } = await client.query(query, values);
    console.log("🏷️  SQL returned rows:", rows);

    if (rows.length === 0) {
      console.log("⚠️ No rows for workerlife—no earnings data");
      return res.status(404).json({ error: "No earnings data found" });
    }

    const {
      total_payment,
      cash_payment,
      payment_count,
      life_earnings,
      avg_rating,
      rejected_count,
      pending_count,
      total_time_worked_hours,
      service_counts,
      cashback_approved_times,
      cashback_gain,
    } = rows[0];

    console.log("📊 Computed metrics:", {
      total_payment,
      cash_payment,
      payment_count,
      life_earnings,
      avg_rating,
      rejected_count,
      pending_count,
      total_time_worked_hours,
      service_counts,
      cashback_approved_times,
      cashback_gain,
    });

    return res.json({
      total_payment: Number(total_payment)                 || 0,
      cash_payment: Number(cash_payment)                   || 0,
      payment_count: Number(payment_count)                 || 0,
      life_earnings: Number(life_earnings)                 || 0,
      avg_rating: Number(avg_rating)                       || 0,
      rejected_count: Number(rejected_count)               || 0,
      pending_count: Number(pending_count)                 || 0,
      total_time_worked_hours: Number(total_time_worked_hours) || 0,
      service_counts: Number(service_counts)               || 0,
      cashback_approved_times: Number(cashback_approved_times) || 0,
      cashback_gain: Number(cashback_gain)                 || 0,
    });
  } catch (error) {
    console.error("🔥 Error fetching worker earnings:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};







const userWorkerInProgressDetails = async (req, res) => {
  const { decodedId } = req.body;
  console.log(decodedId);
  try {
    const query = `
          SELECT 
              a.service_booked, 
              a.time, 
              a.created_at, 
              a.service_status,
              u.area, 
              w.name, 
              ws.profile
          FROM 
              accepted a
          JOIN 
              usernotifications u ON a.user_notification_id = u.user_notification_id
          JOIN 
              workersverified w ON a.worker_id = w.worker_id
          JOIN 
              workerskills ws ON a.worker_id = ws.worker_id
          WHERE 
              a.notification_id = $1
      `;

    const result = await client.query(query, [decodedId]);

    console.log("data",result.rows)

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No details found for the given notification_id" });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching user worker in-progress details:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const workerWorkingStatusUpdated = async (req, res) => {
  const { serviceName, statusKey, currentTime, decodedId } = req.body;

  try {
    // Update the accepted table's service_status column and return only necessary fields.
    const query = `
      WITH updated AS (
        UPDATE accepted
        SET service_status = (
          SELECT jsonb_agg(
            CASE
              WHEN item ->> 'serviceName' = $1 THEN
                jsonb_set(item, '{${statusKey}}', to_jsonb($2::text))
              ELSE item
            END
          )
          FROM jsonb_array_elements(service_status) AS item
        )
        WHERE notification_id = $3
        RETURNING notification_id, service_status, user_id
      )
      SELECT updated.notification_id, updated.service_status, uf.fcm_token
      FROM updated
      JOIN userfcm uf ON updated.user_id = uf.user_id;
    `;

    const values = [serviceName, currentTime, decodedId];
    const { rows } = await client.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Record not found or update failed." });
    }

    // Extract FCM tokens from the result (if multiple rows, there might be duplicates)
    const tokens = rows.map(row => row.fcm_token);

    // Prepare the multicast message payload with a data payload.
    const multicastMessage = {
      tokens,
      data: {
        status: currentTime.toString(),
        statusKey,
        message: "Status updated"
      },
      android: {
        priority: "high"
      },
      apns: {
        payload: {
          aps: {
            contentAvailable: true
          }
        }
      }
    };

    // Send notifications using sendEachForMulticast
    try {
      const fcmResponse = await getMessaging().sendEachForMulticast(multicastMessage);
      fcmResponse.responses.forEach((resp, index) => {
        if (!resp.success) {
          console.error(`Error sending message to token ${tokens[index]}:`, resp.error);
        }
      });

      return res.status(200).json({
        message: "Service status updated successfully and FCM message sent.",
        data: rows[0],
        fcmResponse
      });
    } catch (fcmError) {
      console.error("Error sending notifications:", fcmError);
      return res.status(500).json({ message: "Internal server error", error: fcmError });
    }
  } catch (error) {
    console.error("Error updating service status:", error);
    return res.status(500).json({ message: "Internal server error", error });
  }
};

const WorkerWorkInProgressDetails = async (req, res) => {
  const { decodedId } = req.body;
  console.log(decodedId);
  try {
    const query = `
    SELECT 
        a.service_booked, 
        a.time, 
        a.created_at, 
        a.service_status,
        u.area
    FROM 
        accepted a
    JOIN 
        usernotifications u ON a.user_notification_id = u.user_notification_id
    WHERE 
        a.notification_id = $1
`;

    const result = await client.query(query, [decodedId]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No details found for the given notification_id" });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching user worker in-progress details:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const getWorkDetails = async (req, res) => {
  const { notification_id } = req.body;
  // console.log(notification_id)

  try {
    const queryText = `
      SELECT 
        n.service_booked, 
        n.discount,
        n.total_cost,
        un.city, 
        un.area, 
        un.pincode 
      FROM 
        accepted n
      JOIN 
        usernotifications un 
      ON 
        n.user_notification_id = un.user_notification_id
      WHERE 
        n.notification_id = $1;
    `;
    const queryValues = [notification_id];

    const result = await client.query(queryText, queryValues);

    if (result.rows.length > 0) {
      const workDetails = result.rows[0];
      // const service_booked = result.rows[0].service_booked;

      // const gstRate = 0.05;
      // const discountRate = 0.05;

      // const fetchedTotalAmount = service_booked.reduce(
      //   (total, service) => total + (service.cost || 0),
      //   0
      // );

      // const gstAmount = fetchedTotalAmount * gstRate;
      // const cgstAmount = fetchedTotalAmount * gstRate;
      // const discountAmount = fetchedTotalAmount * discountRate;
      // const fetchedFinalTotalAmount =
      //   fetchedTotalAmount + gstAmount + cgstAmount - discountAmount;

      // const paymentDetails = {
      //   gstAmount,
      //   cgstAmount,
      //   discountAmount,
      //   fetchedFinalTotalAmount,
      // };

      // const fetchedFinalTotalAmount = fetchedTotalAmount - discount;

      res.status(200).json({ workDetails });
    } else {
      res.status(404).json({ error: "Notification not found" });
    }
  } catch (error) {
    console.error("Error fetching work details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const userReferrals = async (req, res) => {
  try {
    const userId = parseInt(req.user.id, 10); // Convert userId to an integer

    // Execute the query and return the result rows directly
    const result = await client.query(
      `
      SELECT 
        u1.referral_code AS referralCode,
        u2.name,
        u2.service_completed
      FROM "user" u1
      LEFT JOIN "user" u2 ON u2.referred_by = u1.referral_code
      WHERE u1.user_id = $1
      `,
      [userId]
    );

    // If no rows are returned, send a 404 response
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "User not found or no referrals available" });
    }

    // Send the raw result rows directly
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching user referrals:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const workerSearch = async (req, res) => {
  try {
    const { phone_number } = req.query;

    if (!phone_number) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Query to fetch worker details, skills, and life stats
    const query = `
      SELECT 
        w.worker_id,
        w.name,
        w.email,
        ws.profile,
        ws.service,
        ws.subservices,
        ws.personaldetails,
        ws.address,
        wl.balance_amount,
        wl.service_counts,
        wl.money_earned,
        wl.average_rating
      FROM workersverified w
      LEFT JOIN workerskills ws ON w.worker_id = ws.worker_id
      LEFT JOIN workerlife wl ON w.worker_id = wl.worker_id
      WHERE w.phone_number = $1;
    `;

    const { rows } = await client.query(query, [phone_number]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }

    // Return the first result (assuming phone_number is unique)
    return res.status(200).json(rows[0]);

  } catch (error) {
    console.error("Error searching worker:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const cashbackHistory = async (req, res) => {
  const { worker_id } = req.query;

  // Validate input
  if (!worker_id) {
    return res.status(400).json({ error: "worker_id is required" });
  }

  try {
    // Query to fetch cashback-related data for the worker
    const query = `
      SELECT 
        cashback_history,
        cashback_gain,
        cashback_approved_times
      FROM workerlife
      WHERE worker_id = $1;
    `;

    const { rows } = await client.query(query, [worker_id]);

    // Check if worker exists
    if (rows.length === 0) {
      return res.status(404).json({ error: "Worker not found" });
    }

    // Return the cashback data
    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error("Error fetching cashback history:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const balanceHistory = async (req, res) => {
  const { worker_id } = req.query;

  if (!worker_id) {
    return res.status(400).json({ error: 'worker_id is required' });
  }

  try {
    const query = `
      SELECT balance_payment_history
      FROM workerlife
      WHERE worker_id = $1;
    `;
    const { rows } = await client.query(query, [worker_id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error fetching balance history:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const getWorkerServiceHistory = async (req, res) => {
  try {
    const { worker_id } = req.query; // Get worker_id from the request body
    console.log(worker_id);

    const query = `
    SELECT 
      payment, 
      payment_type, 
      end_time
    FROM servicecall
    WHERE worker_id = $1 
      AND payment IS NOT NULL;
  `;
    const values = [worker_id];
    const result = await client.query(query, values);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching WorkerServiceHistory:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const currentService = async (req, res) => {
  const { worker_id } = req.query;

  // Validate input
  if (!worker_id) {
    return res.status(400).json({ error: 'worker_id is required' });
  }

  try {
    // Query to fetch the current service details
    const query = `
      SELECT 
        screen_name, 
        params
      FROM workeraction
      WHERE worker_id = $1;
    `;

    const { rows } = await client.query(query, [worker_id]);

    // Check if any data is found
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No current service found for the worker' });
    }

    // Respond with the fetched data
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error fetching current service:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const workerScreenChange = async (req, res) => {
  try {
    let { worker_id, params, screen } = req.body;
    console.log("req.body is", req.body);

    // If params is a string, parse it into JSON.
    if (typeof params === "string") {
      try {
        params = JSON.parse(params);
      } catch (parseError) {
        console.warn("Failed to parse params string:", params);
        return res.status(400).json({
          success: false,
          message:
            "Params should be a valid JSON object or a stringified JSON object.",
        });
      }
    }

    // Validate params and check for encodedId.
    if (!params || typeof params !== "object" || !params.encodedId) {
      console.warn("Invalid params structure:", params);
      return res.status(400).json({
        success: false,
        message:
          "Invalid params format. Expected { encodedId: <Base64String> }",
      });
    }

    // Use the provided encodedId.
    const encodedId = params.encodedId;

    // SQL Query with CTEs
    const query = `
      WITH updated_worker AS (
        UPDATE workeraction
        SET screen_name = CASE WHEN $2 = '' THEN '' ELSE $2 END
        WHERE worker_id = $1
        RETURNING worker_id
      ),
      updated_useraction AS (
        UPDATE useraction
        SET track = COALESCE((
          SELECT jsonb_agg(new_elem)
          FROM (
            SELECT 
              CASE 
                WHEN elem->>'encodedId' = $3 THEN 
                  CASE 
                    WHEN $2 = '' THEN NULL  -- Mark for deletion
                    ELSE jsonb_set(elem, '{screen}', to_jsonb($2)) -- Update screen
                  END
                ELSE elem
              END AS new_elem
            FROM jsonb_array_elements(track) AS elem
          ) AS sub
          WHERE new_elem IS NOT NULL
        ), '[]'::jsonb) -- Ensure empty array instead of NULL
        WHERE user_id IN (
          SELECT user_id FROM accepted WHERE worker_id = $1
        )
        RETURNING user_id, track
      )
      SELECT * FROM updated_useraction;
    `;

    // Execute the query
    const result = await client.query(query, [worker_id, screen, encodedId]);

    console.log("rows",result.rows)

    return res.status(200).json({
      success: true,
      message: "Worker screen updated successfully",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error updating worker screen:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const administratorDetails = async (req, res) => {
  try {
    const { date, startDate, endDate } = req.body;
    console.log("Received payload:", req.body); // Debugging log

    // Define parameters array
    let queryParams = [];
    let paramIndex = 1;

    // Worker & User date condition
    let workerUserDateCondition = '1=1'; // Default: No filter
    if (date) {
      workerUserDateCondition = `DATE(created_at) = $${paramIndex}`;
      queryParams.push(date);
      paramIndex++;
    } else if (startDate && endDate) {
      workerUserDateCondition = `DATE(created_at) BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      queryParams.push(startDate, endDate);
      paramIndex += 2;
    }

    // Service call condition
    let serviceCallCondition = '1=1';
    if (startDate && endDate) {
      serviceCallCondition = `DATE(end_time) BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      queryParams.push(startDate, endDate);
      paramIndex += 2;
    } else if (date) {
      serviceCallCondition = `DATE(end_time) = $${paramIndex}`;
      queryParams.push(date);
      paramIndex++;
    }

    // Cancellation count condition
    let cancelCondition = '1=1';
    if (startDate && endDate) {
      cancelCondition = `DATE(created_at) BETWEEN $${paramIndex} AND $${paramIndex + 1} AND complete_status = 'cancel'`;
      queryParams.push(startDate, endDate);
      paramIndex += 2;
    } else if (date) {
      cancelCondition = `DATE(created_at) = $${paramIndex} AND complete_status = 'cancel'`;
      queryParams.push(date);
      paramIndex++;
    }

    // SQL Query using CTEs
    const query = `
      WITH worker_count AS (
        SELECT COUNT(*) AS total_workers 
        FROM workersverified
        WHERE ${workerUserDateCondition}
      ),
      user_count AS (
        SELECT COUNT(*) AS total_users 
        FROM "user"
        WHERE ${workerUserDateCondition}
      ),
      service_count AS (
        SELECT COUNT(*) AS total_services, COALESCE(SUM(payment), 0) AS total_earnings
        FROM servicecall
        WHERE ${serviceCallCondition}
      ),
      balance_sum AS (
        SELECT COALESCE(SUM(balance_amount), 0) AS total_balance
        FROM workerlife
      ),
      negative_balance_count AS (
        SELECT COUNT(*) AS negative_balance_workers
        FROM workerlife
        WHERE balance_amount < 0
      ),
      cancel_count AS (
        SELECT COUNT(*) AS total_cancels
        FROM completenotifications
        WHERE ${cancelCondition}
      )
      SELECT 
        wc.total_workers,
        uc.total_users,
        sc.total_services,
        sc.total_earnings,
        bs.total_balance,
        nb.negative_balance_workers,
        cc.total_cancels
      FROM worker_count wc
      CROSS JOIN user_count uc
      CROSS JOIN service_count sc
      CROSS JOIN balance_sum bs
      CROSS JOIN negative_balance_count nb
      CROSS JOIN cancel_count cc;
    `;

    // Execute Query Securely
    const result = await client.query(query, queryParams);


    res.status(200).json({
      success: true,
      message: "Administrator details fetched successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Error fetching administrator details:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const fetchOffers = async (req, res) => {
  try {
    const user_id = req.user.id;
    const role = req.user && req.user.role ? req.user.role : 'user';

    const query = `
      SELECT 
        o.offer_code,
        o.title,
        o.description,
        o.discount_percentage,
        o.min_booking_amount,
        o.max_discount_amount,
        o.start_date,
        o.end_date,
        o.applicable_for
      FROM offers o
      LEFT JOIN (
        SELECT offers_used 
        FROM "user" 
        WHERE user_id = $1
      ) u ON true
      WHERE o.is_active = TRUE
        AND o.start_date <= NOW()
        AND o.end_date >= NOW()
        AND (o.applicable_for = 'both' OR o.applicable_for = $2)
        AND (
          -- For offers that contain "WELCOME" in the offer_code,
          -- check that no matching entry in offers_used has a status of "applied" or "used"
          o.offer_code NOT ILIKE '%WELCOME%' OR
          (
            NOT EXISTS (
              SELECT 1 
              FROM jsonb_array_elements(u.offers_used) AS used_offer
              WHERE used_offer->>'offer_code' = o.offer_code
                AND (used_offer->>'status' = 'applied' OR used_offer->>'status' = 'used')
            )
          )
        );
    `;

    const values = [user_id, role];
    const result = await client.query(query, values);
    const offers = result.rows;

    return res.status(200).json({
      success: true,
      offers,
    });
  } catch (error) {
    console.error("Error fetching offers:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const offerValidation = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { offer_code, totalAmount } = req.body;

    if (!user_id || !offer_code || totalAmount == null) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: user_id, offer_code, or totalAmount",
      });
    }

    // 1) First check offer validity to avoid unnecessary user queries
    const offerDetailQuery = `
      SELECT discount_percentage, min_booking_amount, max_discount_amount 
      FROM offers 
      WHERE offer_code = $1 
        AND is_active = TRUE 
        AND start_date <= NOW() 
        AND end_date >= NOW() 
      LIMIT 1`;
    const offerResult = await client.query(offerDetailQuery, [offer_code]);

    if (offerResult.rowCount === 0) {
      return res.status(200).json({
        valid: false,
        error: "Offer not valid or expired",
        discountAmount: 0,
        newTotal: Number(totalAmount),
      });
    }

    // 2) Single user query for all subsequent checks
    const userQuery = `SELECT user_id, offers_used FROM "user" WHERE user_id = $1`;
    const userResult = await client.query(userQuery, [user_id]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = userResult.rows[0];
    const offersUsed = user.offers_used || [];

    // 3) WELCOME offer specific validation
    if (offer_code.includes("WELCOME")) {
      const hasUsedWelcome = offersUsed.some(
        item => item.offer_code === offer_code && 
        (item.status === "applied" || item.status === "used")
      );

      if (hasUsedWelcome) {
        return res.status(200).json({
          valid: false,
          error: "Offer already used",
          discountAmount: 0,
          newTotal: Number(totalAmount),
        });
      }
    }

    // 4) Single conditional update for missing offers using JSONB operations
    const offerExists = offersUsed.some(item => item.offer_code === offer_code);
    if (!offerExists) {
      const updateQuery = `
        UPDATE "user"
        SET offers_used = COALESCE(offers_used, '[]'::jsonb) || $1::jsonb
        WHERE user_id = $2
        AND NOT EXISTS (
          SELECT 1 
          FROM jsonb_array_elements(COALESCE(offers_used, '[]'::jsonb)) AS item
          WHERE item->>'offer_code' = $3
        )`;
        await client.query(
          updateQuery,
          [
            JSON.stringify([{ offer_code, status: "pending", quantity: 0 }]),
            user_id,
            offer_code
          ]
        );        
    }

    // 5) Final validation and calculation
    const { discount_percentage, min_booking_amount, max_discount_amount } = offerResult.rows[0];

    if (Number(totalAmount) < Number(min_booking_amount)) {
      return res.status(200).json({
        valid: false,
        error: `Minimum booking amount required is ₹${min_booking_amount}`,
        discountAmount: 0,
        newTotal: Number(totalAmount),
      });
    }

    const discountCalc = Math.min(
      (Number(totalAmount) * Number(discount_percentage)) / 100,
      Number(max_discount_amount)
    );
    const newTotal = Number(totalAmount) - discountCalc;

    return res.status(200).json({
      valid: true,
      discountAmount: discountCalc,
      newTotal,
      error: null,
    });

  } catch (error) {
    console.error("Error in offer validation:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = {
  getUserById,
  getElectricianServices,
  verifyOTP,
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
  serviceCompleted,
  checkTaskStatus,
  getTimeDifferenceInIST,
  workCompletionCancel,
  getAllLocations,
  userActionRemove,
  getWorkerBookings,
  sendSMSVerification,
  sendOtp,
  validateOtp,
  getServiceByName,
  getWorkerProfleDetails,
  getWorkerReviewDetails,
  getPaymentDetails,
  getServiceCompletedDetails,
  getWorkerEarnings,
  getUserAndWorkerLocation,
  userNavigationCancel,
  workerNavigationCancel,
  workerCompleteSignUp,
  checkOnboardingStatus,
  getServicesPhoneNumber,
  registrationSubmit,
  addBankAccount,
  getAllBankAccounts,
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
  balanceHistory,
  getWorkerServiceHistory,
  currentService,
  workerScreenChange ,
  getPendingWorkersNotStarted,
  administratorDetails,
  workerTokenVerification,
  adminLogin,
  WorkerValidateOtp,
  WorkerSendOtp,
  partnerValidateOtp,
  createOrder,
  verifyPayment,
  createFundAccount,
  validateAndSaveUPI,
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
  homeServices,
  getSpecialOffers,
  partnerSendOtp
};
