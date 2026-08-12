export const config = {
  // Required by Payment SDK
  projectKey: process.env.CTP_PROJECT_KEY!,
  clientId: process.env.CTP_CLIENT_ID!,
  clientSecret: process.env.CTP_CLIENT_SECRET!,
  jwksUrl:
    process.env.CTP_JWKS_URL ||
    "https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json",
  jwtIssuer:
    process.env.CTP_JWT_ISSUER ||
    "https://mc-api.europe-west1.gcp.commercetools.com",
  authUrl:
    process.env.CTP_AUTH_URL ||
    "https://auth.europe-west1.gcp.commercetools.com",
  apiUrl:
    process.env.CTP_API_URL || "https://api.europe-west1.gcp.commercetools.com",
  sessionUrl:
    process.env.CTP_SESSION_URL ||
    "https://session.europe-west1.gcp.commercetools.com/",
  healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || "5000"),

  // Required by logger
  loggerLevel: process.env.LOGGER_LEVEL || "info",

  // Update with specific payment providers config
  mockClientKey: process.env.MOCK_CLIENT_KEY,
  mockEnvironment: process.env.MOCK_ENVIRONMENT,

  // Update with specific payment providers config
  novalnetPublicKey: process.env.NOVALNET_PUBLIC_KEY || "",
  novalnetPrivateKey: process.env.NOVALNET_PRIVATE_KEY!,
  novalnetTariff: process.env.NOVALNET_TARIFF_KEY!,
  novalnetWebhookURL: process.env.NOVALNET_WEBHOOK_URL!,


  merchanturl: process.env.MERCHANT_RETURN_URL || "",
  url: process.env.URL || "",

  novalnet_INVOICE_TestMode:
    process.env.NOVALNET_INVOICE_TEST_MODE || "0",
  novalnet_PREPAYMENT_TestMode:
    process.env.NOVALNET_PREPAYMENT_TEST_MODE || "0",
  novalnet_INVOICE_DueDate:
    process.env.NOVALNET_INVOICE_DUE_DATE || "14",
  novalnet_PREPAYMENT_DueDate:
    process.env.NOVALNET_PREPAYMENT_DUE_DATE || "14",
  novalnet_INVOICE_PaymentAction:
    process.env.NOVALNET_INVOICE_PAYMENT_ACTION || "payment",
  novalnet_PREPAYMENT_PaymentAction:
    process.env.NOVALNET_PREPAYMENT_PAYMENT_ACTION || "payment",

  // Payment Providers config
  returnurl: process.env.RETURN_URL,
  merchantReturnUrl: process.env.MERCHANT_RETURN_URL || "",

  // TODO review these configurations
  // supportedUIElements: convertStringCommaSeparatedValuesToArray(process.env.SUPPORTED_UI_ELEMENTS),
  // enableStoreDetails: process.env.ENABLE_STORE_DETAILS === 'true' ? true : false,
  // sellerReturnUrl: process.env.SELLER_RETURN_URL || ''
};
// Config loaded successfully
export const getConfig = () => {
  return config;
};
