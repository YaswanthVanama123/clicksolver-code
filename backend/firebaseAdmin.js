require("dotenv").config(); // Load environment variables

const admin = require("firebase-admin");

// const serviceAccount = {
//   type: "service_account",
//   project_id: "clicksolver-fa1a6",
//   private_key_id: "09c40c8aefa4be0ba2f8ca50bb6de087fe19b595",
//   private_key:
//     "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDeZF2LVoyKSmsP\n/d+zK5YNLiztl8p1Pkh3t1k8JUcqPPA6OC/pmeNHVEl8L8kH2lcVFNfcsRjIU0Yf\nzWcIGcDkSKuzv9m5maqdtN1HIpgHysrLb1A/Z2Y0kLz+3PZ03uwHIH1sqvELaPj6\nuu09fIa3PQzlxE6YvIoD6qax39lf+MUH20hJZk+ckxX3BBgXoYiQJdIzTAdS/gPP\noitX+8pxTh6J+6qaeLPw6XZqFCvBeDx45XHroe3IjyF1ffQK7lPOzp1LPxwovDop\n2t6h6Mpb/g8APj8Bgl2YYI2zNt0LJldmSCz4wVqI+KXc6TE5K5tVxaGTsTKLJ5pC\nux5yGH2tAgMBAAECggEAFQ8wBIfXmyjc5pDF5DOWa/0ZaA5dr6iMODn2i0mEaa2H\nmhvD/b0C1rhWlRn5UXMNmAN3RYDHtgCcvVo4DX5S08tF5ymdtoOksnZ0Fc5i0yoS\n9hy+XqKt/QBPxVqrQ/nwI+Shu+6cENaJ7URSPuZR43w2gnOKddA0yZYo3uMxtHKv\nFPcQjpdom4CWQjqN8QPNXaJW8OuTuV+tiVgRBhAGdbKTN98sMnNB4V7QVTEbQFir\noMQI9kkVzAzlTUz9i5kXg3p5rrhGDXwrRnRqXdzwq8mPp61tDl+Lc8/jslMijUy0\ngbdx6Rpbo0yyFkEERdvFqN92cL6j56aKtkX1+8r/QQKBgQDv+aaulOCWrBwfPZ72\nzeUBCZT1hLi/COoFm3/IGxC2/rr6OIvfAD3lwLldHGMD9+yXVNGqDFczJjLSL5Mo\nvZpDSIqgtQS2gR6Qh7CSxIaueBQT0nIm6g8y0NdtTcPj45PvMELfmqc21z39GdVq\ngD2R4KmvXNbsRuzZvR6Fr7rMOQKBgQDtPiHkdw+IJM2ulbidI7bSNk4DPYcg0JQ+\ngxqeDkMVMQbFLR7G1T2DqgNQKpHejJSjg6CJ0YMn+8NMIUZVy/DaTESZSf/KJpNR\nlFFeKyCp7TocycL9H0M9x/mti9w1R5zkhbfujTLxDYntMtIAWrZJSVZikmJKoIeL\nmvOf3U2lFQKBgQDFGrPqb0Ps3d6XVmCr7L9s07by1hl8Z1D4XBlffcOD2sQu46UW\n/Dba8CoQLVGyn79HKRaw6kPxMi3J7+OaMelz3DBpAWWmlXVKVvkUA7FvuhcblN3H\n0rW7EkfvclE0a+dFLcmvqXIwnChBLCfbuwtXN0WIUOQC29qMmUZpncX7GQKBgBkB\nv5jRY/W5y2Rnq7oElbS6vKZiyeePlNCyCRA3+KI3NLt78g6LU5yZQxgkJJQMxW4m\n5bkhOG3yf7d6mmtYv96Cw4hU4H1ya3zh4WHHsf23X7TBH6iGrxPIDG1anK+RCNyd\nq7GdeI0oHC3AeZpH9YbsEAr72xh6q07v2lYzgYexAoGAH+nlivbxFlm7Z/PLQGjV\nTtH3Fhz20TnS2aanlTWnB6R7ZooZRSvwXwHWtVfL8kqT5ovTawLjd16F/ujX3H71\nNHhu7eaQxkWyU3sHBq3AZGvHu1Z91lxvqmk/9wDcQ8+RMm1YxjkGjy0qPwy2T6rS\ndloseZgG9M8efa9k+w8SKBQ=\n-----END PRIVATE KEY-----\n",
//   client_email:
//     "firebase-adminsdk-qziff@clicksolver-fa1a6.iam.gserviceaccount.com",
//   client_id: "112431579495505930871",
//   auth_uri: "https://accounts.google.com/o/oauth2/auth",
//   token_uri: "https://oauth2.googleapis.com/token",
//   auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
//   client_x509_cert_url:
//     "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-qziff%40clicksolver-fa1a6.iam.gserviceaccount.com",
//   universe_domain: "googleapis.com",
// };




const serviceAccount = {
  type: "service_account",
  project_id: "your-guider-fbcb0",
  private_key_id: "b1a3eb2d6a151d58900d86be1431377cc8314c82",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCmXjUbi0AHHX2Z\n0GIWKn6raD0du/trTE4kmnfgn/bdDeKHF6WlpF51DxFyQPUIIsGO/XqyerXyWqZa\nsNLULDrijWesYg46p81R0hNMvXSF1K3SaV28rgxWilYXNiTzcC10wqwxjQkDsfRZ\nOMTnSutcZ5dvdlEtme2SoFPxsgni30yEW6M87P4moHJfQVXYCNBHOvp2JlINqp/j\nSsub/zQhcoJdvGEJozUgapD/oYBRxOh6YZ4WYz05XcyLoaRMffu+NcoZHRlKktMy\n7DXfjgTJDFjBMLuQhhSwRQn8muQmUUwRabV37DktdxDR+fmt0KSbcA5J/DQ7fnwm\n+gSY1Nt9AgMBAAECggEAEdLdezQ1uZ1r96bm30uRsxDxnUYmtzXfWFYROkhBBSlH\n5+O9bCvaL83bt2MkrUi19nkLJGR3qj2SfXxctf0AGQX/wazmq9uO6HFqfmn8uhrR\nPY3qzDxUV5AuDYIQPuF5iT0TACMFQHdX/5gQplv1L7rsczVYmJtZY8BYBfimTP8l\ncLYSFhycmcuMmhl/vXeR4/mEldV/xEYWQBiF+hIK9h1Pntp4ZL1HxzWwgX/hY9LY\nYGDugOpt7mbcZ9Y50HbAMJkJOlpCHGwd86avJxlgRqjXM+jLDrAVe5Pbyp7UuJ1A\nqKA5mPldc1S63S7HbYbvPxFTVnuPSn/e2MZuJe8+MQKBgQC7UV2tMn066pEegU8h\nlBIbsE+jCrwbAoQAXtqqhHTLrldQtFsvkiXLMIvMWZm80hZacb0dQWuro+5wBZER\nifGm/R4Rv0Pss2xFHB+OihG5j0/sKUX2FYqwrVtfQMJLpTVX1yBwSXFBWbt98QoX\n3AA/A4/XVsgn92SdGDgDTHRcbQKBgQDjXmFCnF0M7y1LAGgtwiudexy5siCf27Yv\nuNcg0v5lyEJtIdoNNUCraWd180R3OXyBUavdDkkqD0IHjcfPc3i3/NpKRVufeL4+\n1PSagfUcb5yUrEMnSXs76roSe8xecU3uhqhQtHvrNrCQigu+QlrrYslPxxSXLeZS\nSVlpPmXxUQKBgQCXsXfMN9QEb0sgShWcGr5jX+/OGHZm5S2i4y3v4x52h/Q77iLe\nLlue5eyAi5sdt4DUs8EzvPQF5tbELy3g5zYkRl0ggCTwvgiTGwhPNW7PN8jAdlgq\nxh0voOQbCmWOPvco8JVbeY5XHuTgQ+ApnEcywJ6vA59KBmWbdq59tV+SLQKBgQCr\nFuLy/7xZNkUL0gOSozC0sOY9qZc5E1h1co6XCY4awuWRP07Yb4D5Ozh6HhMf7+cL\nXIyJq+1MM+0IyBxZs1dcg20zRBuc1Xu6xf5FoZLy0d2uVi22C2oq/QcFT5jKXFI7\nMaLID/fLV/zm1qndggruYwh++pw44nYU51LbifOl8QKBgCE7U+OjJbqdxclA+3q5\niMy5anbXdm2aybHetEwQZcyJxOzjVIuKy/QtkTo0WzciJG+J6dSmHrXd+Xt8piMv\nr2hn2Wj/lYXZjFgFmXSPHD47RXQ3Xkr0GUXcXMQgb2nuxhBYHSKtzrVUhLoq/zQM\nQ7JncQuZQiNGTe4/loUHxqPY\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk-ozxmy@your-guider-fbcb0.iam.gserviceaccount.com",
  client_id: "116637598165256229163",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-ozxmy%40your-guider-fbcb0.iam.gserviceaccount.com",
  universe_domain: "googleapis.com"
}


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;