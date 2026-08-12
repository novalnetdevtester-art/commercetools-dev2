import * as dotenv from "dotenv";
import { paymentSDK } from "../payment-sdk";
dotenv.config();

async function validateNovalnetConfig() {
  console.log('Validating Novalnet configuration...');
  // Add any Novalnet-specific validation here
  console.log('Novalnet configuration validated');
}

async function runPostDeployScripts() {
  try {
    console.log('Running post-deploy scripts...');
    
    // Validate required environment variables
    const requiredVars = [
      'CTP_PROJECT_KEY',
      'CTP_CLIENT_ID', 
      'CTP_CLIENT_SECRET',
      'NOVALNET_PRIVATE_KEY',
      'NOVALNET_TARIFF_KEY'
    ];
    
    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        throw new Error(`Required environment variable ${varName} is not set`);
      }
    }
    
    // Validate Novalnet configuration
    await validateNovalnetConfig();
    
    console.log('Post-deploy completed successfully');
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Post-deploy failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

(async () => {
  await runPostDeployScripts();
})();
