"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
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
    }
    catch (error) {
        if (error instanceof Error) {
            process.stderr.write(`Post-deploy failed: ${error.message}\n`);
        }
        process.exitCode = 1;
    }
}
(async () => {
    await runPostDeployScripts();
})();
