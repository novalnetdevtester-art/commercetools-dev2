import { FakeSdk } from '../fake-sdk';
import { ComponentOptions, PaymentComponent, PaymentMethod, PaymentResult } from '../payment-enabler/payment-enabler';
import { BaseOptions } from "../payment-enabler/payment-enabler-mock";

export type ElementOptions = {
  paymentMethod: PaymentMethod;
};



/**
 * Base Web Component
 */
export abstract class BaseComponent implements PaymentComponent {
  protected paymentMethod: ElementOptions['paymentMethod'];
  protected sdk: FakeSdk;
  protected processorUrl: BaseOptions['processorUrl'];
  protected sessionId: BaseOptions['sessionId'];
  protected environment: BaseOptions['environment'];
  protected onComplete: (result: PaymentResult) => void;
  protected onError: (error: any, context?: { paymentReference?: string }) => void;
  private paymentCompleted: boolean = false;
  private commercetoolsPaymentId: string | null = null;

  constructor(paymentMethod: PaymentMethod, baseOptions: BaseOptions, _componentOptions: ComponentOptions) {
    this.paymentMethod = paymentMethod;
    this.sdk = baseOptions.sdk;
    this.processorUrl = baseOptions.processorUrl;
    this.sessionId = baseOptions.sessionId;
    this.environment = baseOptions.environment;
    this.onComplete = baseOptions.onComplete;
    this.onError = baseOptions.onError;
  }

  abstract submit(): void;

  abstract mount(selector: string): void ;

  protected completePayment(result: PaymentResult) {
    if (!this.paymentCompleted) {
      this.paymentCompleted = true;
      console.log('Payment completed:', result);
      this.onComplete(result);
    }
  }

  protected initializeNovalnetChildWindow(txnSecret: string, paymentReference?: string) {
    console.log('=== NOVALNET CHILD WINDOW INIT ===');
    console.log('txn_secret:', txnSecret);
    console.log('commercetools payment ID:', paymentReference);
    
    if (paymentReference) {
      this.commercetoolsPaymentId = paymentReference;
    }
    
    this.loadNovalnetScript(() => {
      console.log('Novalnet script loaded successfully');
      this.setupNovalnetChildWindow(txnSecret);
      
      // Fallback timeout to ensure onComplete is called
      setTimeout(() => {
        console.log('Payment timeout - checking if payment was completed');
        // Only trigger if payment hasn't been completed yet
        if (typeof window.Novalnet !== 'undefined') {
          window.Novalnet.closeChildWindow('timeout');
        }
      }, 300000); // 5 minutes timeout
    });
  }

  private loadNovalnetScript(callback: () => void) {
    console.log('Loading Novalnet script...');
    if (document.getElementById('novalnet-checkout-js')) {
      console.log('Novalnet script already loaded');
      callback();
      return;
    }

    const script = document.createElement('script');
    script.id = 'novalnet-checkout-js';
    script.src = `https://paygate.novalnet.de/v2/checkout-1.1.0.js?t=${Date.now()}`;
    script.integrity = 'sha384-RTo1KLOtNoTrL1BSbu7e6j+EBW5LRzBKiOMAo5C2MBUB9kapkJi1LPG4jk5vzPyv';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      console.log('Novalnet script loaded from CDN');
      callback();
    };
    script.onerror = (error) => {
      console.error('Failed to load Novalnet SDK:', error);
      this.onError('Failed to load Novalnet SDK');
    };
    document.head.appendChild(script);
  }

  private setupNovalnetChildWindow(txnSecret: string) {
    console.log('Setting up Novalnet child window...');
    console.log('window.Novalnet available:', typeof window.Novalnet !== 'undefined');
    
    if (typeof window.Novalnet !== 'undefined') {
      console.log('Setting Novalnet parameters...');
      window.Novalnet.setParam('nn_it', 'child_window');
      window.Novalnet.setParam('txn_secret', txnSecret);
      window.Novalnet.setParam('rftarget', 'top');
      
      console.log('Parameters set, setting up message listener...');
      this.setupNovalnetMessageListener();
      
      console.log('Rendering Novalnet child window...');
      window.Novalnet.render(); // This automatically creates the child window
      console.log('Novalnet render called');
    } else {
      console.error('Novalnet SDK not available on window object');
      this.onError('Novalnet SDK not loaded properly');
    }
  }

  protected setupNovalnetMessageListener() {
    const messageHandler = (event: MessageEvent) => {
      if (event.origin === 'https://paygate.novalnet.de') {
        try {
          let eventData = event.data;
          if (typeof eventData === 'string') {
            eventData = JSON.parse(eventData);
          }
          
          console.log('=== NOVALNET MESSAGE RECEIVED ===:', eventData);
          console.log('Event origin:', event.origin);
          console.log('Raw event data:', event.data);
          
          if (eventData.status_code === '100' || eventData.status === 100) {
            if (typeof window.Novalnet !== 'undefined') {
              window.Novalnet.closeChildWindow();
            }
            
            this.completePayment({
              isSuccess: true,
              paymentReference: eventData.paymentReference || eventData.commercetoolsPaymentId || 'success',
            });
            return;
          }
          
          if (eventData.nnpf_postMsg === 'payment_cancel') {
            if (typeof window.Novalnet !== 'undefined') {
              window.Novalnet.closeChildWindow();
            }
            
            this.completePayment({
              isSuccess: false,
              paymentReference: eventData.paymentReference || eventData.commercetoolsPaymentId,
            });
            return;
          }
          
          if (eventData.status_code && eventData.status_code !== '100') {
            if (typeof window.Novalnet !== 'undefined') {
              window.Novalnet.closeChildWindow();
            }

            this.completePayment({
              isSuccess: false,
              paymentReference: eventData.paymentReference || 'failed',
            });
            return;
          }
          
        } catch (e) {
          console.error('Error parsing Novalnet message:', e);
          this.completePayment({
            isSuccess: false,
            paymentReference: 'error',
          });
        }
      }
    };
    
    if (window.addEventListener) {
      window.addEventListener('message', messageHandler, false);
    } else {
      (window as any).attachEvent('onmessage', messageHandler);
    }
    
    // Handle window close/refresh events - PRIORITY: Trigger onComplete
    const beforeUnloadHandler = () => {
      if (typeof window.Novalnet !== 'undefined') {
        window.Novalnet.closeChildWindow('refresh');
      }
    };
    
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }

  showValidation?(): void;
  isValid?(): boolean;
  getState?(): {
    card?: {
      endDigits?: string;
      brand?: string;
      expiryDate? : string;
    }
  };
  isAvailable?(): Promise<boolean>;
}
