import {
  Cart,
  healthCheckCommercetoolsPermissions,
  statusHandler,
} from "@commercetools/connect-payments-sdk";
import { ConfigResponse, StatusResponse } from "./types/operation.type";
import { Address, Customer } from "@commercetools/platform-sdk";
import { SupportedPaymentComponentsSchemaDTO } from "../dtos/operations/payment-componets.dto";
import packageJSON from "../../package.json";
import { AbstractPaymentService } from "./abstract-payment.service";
import { getConfig } from "../config/config";
import { appLogger, paymentSDK } from "../payment-sdk";
import crypto, { randomUUID } from "crypto";
import dns from "dns/promises";
import { FastifyRequest } from "fastify";
import {
  CreatePaymentRequest,
  NovalnetPaymentServiceOptions,
} from "./types/novalnet-payment.type";
import {
  PaymentMethodType,
  PaymentResponseSchemaDTO,
} from "../dtos/novalnet-payment.dto";
import {
  getCartIdFromContext,
  getFutureOrderNumberFromContext,
  getMerchantReturnUrlFromContext,
  getPaymentInterfaceFromContext,
} from "../libs/fastify/context/context";
import { log } from "../libs/logger";
import * as Context from "../libs/fastify/context/context";
import {
  createOrderPaymentCommentsType,
  createTransactionCommentsType,
} from "../utils/custom-fields";
import { projectApiRoot } from "../utils/ct-client";
import customObjectService from "./ct-custom-object.service";
import { SupportedLocale, t } from "../i18n";
import { PaymentUpdateAction } from "@commercetools/platform-sdk";
import JSONbig from "json-bigint";
import { NovalnetPaymentCommonService } from "./novalnet-payment-common.service";

type NovalnetConfig = {
  testMode: string;
  paymentAction: string;
  dueDate: string;
  minimumAmount: string;
  enforce3d: string;
  displayInline: string;
  allowb2bCustomers: string;
  forceNonGuarantee: string;
};

type TransactionCommentParams = {
  eventTID?: string | null;
  parentTID?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  date?: string | null;
  time?: string | null;
  transactionID?: string | null;
  dueDate?: string | null;
};

function getNovalnetConfigValues(
  type: string,
  config: Record<string, any>,
): NovalnetConfig {
  const upperType = type.toUpperCase();
  return {
    testMode: String(config?.[`novalnet_${upperType}_TestMode`]),
    paymentAction: String(config?.[`novalnet_${upperType}_PaymentAction`]),
    dueDate: String(config?.[`novalnet_${upperType}_DueDate`]),
    minimumAmount: String(config?.[`novalnet_${upperType}_MinimumAmount`]),
    enforce3d: String(config?.[`novalnet_${upperType}_Enforce3d`]),
    displayInline: String(config?.[`novalnet_${upperType}_DisplayInline`]),
    allowb2bCustomers: String(
      config?.[`novalnet_${upperType}_Allowb2bCustomers`],
    ),
    forceNonGuarantee: String(
      config?.[`novalnet_${upperType}_ForceNonGuarantee`],
    ),
  };
}

function getPaymentDueDate(configuredDueDate: number | string): string | null {
  const days = Number(configuredDueDate);
  if (isNaN(days)) {
    return null;
  }
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);
  const formattedDate = dueDate.toISOString().split("T")[0];
  return formattedDate;
}

export class NovalnetPaymentService extends AbstractPaymentService {
  private readonly common: NovalnetPaymentCommonService;

  constructor(opts: NovalnetPaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService);
    this.common = new NovalnetPaymentCommonService(
      opts.ctPaymentService,
      opts.ctCartService,
    );
  }

  public async config(): Promise<ConfigResponse> {
    const config = getConfig();
    return {
      clientKey: config.mockClientKey,
      environment: config.mockEnvironment,
    };
  }

  public async status(): Promise<StatusResponse> {
    const handler = await statusHandler({
      timeout: getConfig().healthCheckTimeout,
      log: appLogger,
      checks: [
        healthCheckCommercetoolsPermissions({
          requiredPermissions: [
            "manage_payments",
            "view_sessions",
            "view_api_clients",
            "manage_orders",
            "introspect_oauth_tokens",
            "manage_checkout_payment_intents",
            "manage_types",
          ],
          ctAuthorizationService: paymentSDK.ctAuthorizationService,
          projectKey: getConfig().projectKey,
        }),
        async () => {
          try {
            const paymentMethods = "card";
            return {
              name: "Mock Payment API",
              status: "UP",
              message: "Mock api is working",
              details: {
                paymentMethods,
              },
            };
          } catch (e) {
            return {
              name: "Mock Payment API",
              status: "DOWN",
              message:
                "The mock payment API is down for some reason. Please check the logs for more details.",
              details: {
                error: e,
              },
            };
          }
        },
      ],
      metadataFn: async () => ({
        name: packageJSON.name,
        description: packageJSON.description,
        "@commercetools/connect-payments-sdk":
          packageJSON.dependencies["@commercetools/connect-payments-sdk"],
      }),
    })();
    return handler.body;
  }

  public async getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO> {
    return {
      components: [
        { type: PaymentMethodType.INVOICE },
        { type: PaymentMethodType.PREPAYMENT },
        { type: PaymentMethodType.GUARANTEED_INVOICE },
        { type: PaymentMethodType.GUARANTEED_SEPA },
        { type: PaymentMethodType.IDEAL },
        { type: PaymentMethodType.PAYPAL },
        { type: PaymentMethodType.ONLINE_BANK_TRANSFER },
        { type: PaymentMethodType.ALIPAY },
        { type: PaymentMethodType.BANCONTACT },
        { type: PaymentMethodType.BLIK },
        { type: PaymentMethodType.EPS },
        { type: PaymentMethodType.MBWAY },
        { type: PaymentMethodType.MULTIBANCO },
        { type: PaymentMethodType.POSTFINANCE },
        { type: PaymentMethodType.POSTFINANCE_CARD },
        { type: PaymentMethodType.PRZELEWY24 },
        { type: PaymentMethodType.TRUSTLY },
        { type: PaymentMethodType.TWINT },
        { type: PaymentMethodType.WECHATPAY },
        { type: PaymentMethodType.SEPA },
        { type: PaymentMethodType.ACH },
        { type: PaymentMethodType.CREDITCARD },
      ],
    };
  }

  public ctcc(cart: Cart) {
    return paymentSDK.ctCartService.getOneShippingAddress({ cart });
  }

  public ctbb(cart: Cart) {
    return cart.billingAddress ?? null;
  }

  public customerDetails(customer: Customer) {
    return customer;
  }

public async failureResponse({ data }: { data: any }) {
  const parsedData = typeof data === "string" ? JSON.parse(data) : data;

  log.info("[failureResponse] Processing payment failure", {
    ctPaymentID: parsedData.ctPaymentID,
    pspReference: parsedData.pspReference,
  });

  await createTransactionCommentsType();

  const raw = await this.ctPaymentService.getPayment({
    id: parsedData.ctPaymentID,
  } as any);

  const payment = (raw as any)?.body ?? raw;
  const version = payment.version;

  const tx = payment.transactions?.find(
    (t: any) => t.interactionId === parsedData.pspReference,
  );

  if (!tx) {
    throw new Error("Transaction not found");
  }

  const txId = tx.id;

  if (!txId) {
    throw new Error("Transaction missing id");
  }

  const transactionComments = `Novalnet Transaction ID: ${
    parsedData.tid ?? "NN/A"
  }\nPayment Type: ${parsedData.payment_type ?? "NN/A"}\n${
    parsedData.status_text ?? "NN/A"
  }`;

  const actions: PaymentUpdateAction[] = [];
  
  if (!tx.custom?.type) {
    actions.push({
      action: "setTransactionCustomType",
      transactionId: txId,
      type: {
        key: "novalnet-custom-field",
        typeId: "type",
      },
    });
  }

  actions.push({
    action: "setTransactionCustomField",
    transactionId: txId,
    name: "transactionComments",
    value: transactionComments,
  });

  actions.push({
    action: "changeTransactionState",
    transactionId: txId,
    state: "Failure",
  });

  await projectApiRoot
    .payments()
    .withId({ ID: parsedData.ctPaymentID })
    .post({
      body: {
        version,
        actions,
      },
    })
    .execute();

  log.info("[failureResponse] Payment failure comments saved", {
    ctPaymentID: parsedData.ctPaymentID,
    transactionId: txId,
  });
}
  public async getConfigValues({ data }: { data: any }) {
    try {
      const clientKey = String(getConfig()?.novalnetClientkey ?? "");
      return { paymentReference: clientKey };
    } catch (err) {
      return { paymentReference: "" };
    }
  }

  public async getCustomerAddress(
    request: CreatePaymentRequest,
  ): Promise<PaymentResponseSchemaDTO> {
    const cartId = request.cartId;
    if (!cartId) {
      log.warn("service-customer-address - missing cartId");
      return { paymentReference: "customAddress" };
    }
    let ctCart: any;
    try {
      ctCart = await this.ctCartService.getCart({ id: cartId });
    } catch (err) {
      log.error("Failed to fetch cart", err);
      return { paymentReference: "customAddress" };
    }

    const shippingAddress: Address | null = ctCart.shippingAddress ?? null;
    const billingAddress: Address | null = ctCart.billingAddress ?? null;
    let firstName: string =
      shippingAddress?.firstName ?? ctCart.customerFirstName ?? "";
    let lastName: string =
      shippingAddress?.lastName ?? ctCart.customerLastName ?? "";
    let email: string = ctCart.customerEmail ?? "";

    if (ctCart.customerId) {
      try {
        const apiRoot =
          (this as any).projectApiRoot ??
          (globalThis as any).projectApiRoot ??
          projectApiRoot;
        const customerRes = await apiRoot
          .customers()
          .withId({ ID: ctCart.customerId })
          .get()
          .execute();

        const ctCustomer: Customer = customerRes.body;
        if (!firstName) firstName = ctCustomer.firstName ?? "";
        if (!lastName) lastName = ctCustomer.lastName ?? "";
        if (!email) email = ctCustomer.email ?? "";
      } catch (err) {
        log.warn("Failed to fetch customer data, using cart only", {
          cartCustomerId: ctCart.customerId,
          error: String(err),
        });
      }
    }
    const result: PaymentResponseSchemaDTO = {
      paymentReference: "customAddress",
      firstName,
      lastName,
      email,
      shippingAddress,
      billingAddress,
    } as any;

    return result;
  }

  public async transactionUpdate({ data }: { data: any }) {
    try {
      const parsedData = typeof data === "string" ? JSON.parse(data) : data;
      if (!parsedData?.ctPaymentId) {
        throw new Error("Missing ctPaymentId in transactionUpdate");
      }
      log.info("[transactionUpdate] Starting transaction update", {
        ctPaymentId: parsedData.ctPaymentId,
        pspReference: parsedData.pspReference,
      });

      const config = getConfig();
      await createTransactionCommentsType();
      await createOrderPaymentCommentsType();
      getMerchantReturnUrlFromContext() || config.merchantReturnUrl;

      const novalnetPayload = {
        transaction: { tid: parsedData?.interfaceId ?? "" },
      };
      const lang = parsedData?.lang as SupportedLocale;

      log.info("[transactionUpdate] Fetching transaction details from Novalnet", {
        tid: parsedData?.interfaceId,
      });

      let responseData: any;
      try {
        responseData = await this.callNovalnet(
          "https://payport.novalnet.de/v2/transaction/details",
          novalnetPayload,
        );
        log.info("[transactionUpdate] Novalnet transaction details fetched", {
          status: responseData?.transaction?.status,
          tid: responseData?.transaction?.tid,
        });
      } catch (err) {
        log.error("[transactionUpdate] Failed to fetch Novalnet transaction details", err);
        throw new Error("Payment verification failed");
      }

      const pspReference = parsedData.pspReference;
      if (!pspReference) {
        throw new Error("Missing pspReference");
      }

      const tid = responseData?.transaction?.tid ?? "";
      const paymentType = responseData?.transaction?.payment_type ?? "";
      const isTestMode = responseData?.transaction?.test_mode == 1;
      const status = String(responseData?.transaction?.status ?? "").toUpperCase();
      const { state, transactionType } = this.common.getTransactionStatus(status);
      const statusCode = responseData?.transaction?.status_code ?? "";
      const locale = lang === "en" ? "en" : "de";
      const transactionComments = [
        t(locale, "payment.transactionId", { tid }),
        t(locale, "payment.paymentType", { type: paymentType }),
        isTestMode ? t(locale, "payment.testMode") : "",
      ].join("\n");

      const { txId } = await this.common.updatePaymentTransaction({
        paymentId: parsedData.ctPaymentId,
        pspReference,
        transactionComments,
        statusCode,
        state,
        appendComments: false,
        setCustomType: true,
        errorMessage: "Transaction not found for PSP reference",
      });

      await this.common.addSettlementTransactionIfRequired({
        paymentId: parsedData.ctPaymentId,
        pspReference,
        amount: responseData?.transaction?.amount,
        currency: responseData?.transaction?.currency,
        transactionType,
        status,
      });

      log.info("[transactionUpdate] Payment updated in CT", {
        ctPaymentId: parsedData.ctPaymentId,
        state,
        statusCode,
      });

      const updatedPaymentRoot = await projectApiRoot
        .payments()
        .withId({ ID: parsedData.ctPaymentId })
        .get()
        .execute();

      const orderSearch = await projectApiRoot.orders().get({
        queryArgs: {
          where: `paymentInfo(payments(id="${parsedData.ctPaymentId}"))`,
          limit: 1,
        },
      }).execute();

      const orderRoot = orderSearch.body.results?.[0];
      if (!orderRoot) {
        log.info("[transactionUpdate] No order linked to this payment – nothing to sync yet", {
          ctPaymentId: parsedData.ctPaymentId,
        });
        return;
      }

      const orderId = orderRoot.id;
      const updatedTransaction = updatedPaymentRoot.body.transactions?.find(
        (t) => t.id === txId,
      );
      const paymentComment =
        updatedTransaction?.custom?.fields?.transactionComments ?? transactionComments;

      const order = await projectApiRoot.orders().withId({ ID: orderId }).get().execute();
      await projectApiRoot.orders().withId({ ID: orderId }).post({
        body: {
          version: order.body.version,
          actions: [
            {
              action: "setCustomType",
              type: { key: "order-payment-comments", typeId: "type" },
            },
            {
              action: "setCustomField",
              name: "paymentComments",
              value: paymentComment,
            },
          ],
        },
      }).execute();

      try {
        const container = "nn-private-data";
        const key = `${parsedData.ctPaymentId}-${pspReference}`;
        await customObjectService.upsert(container, key, {
          tid,
          paymentMethod: paymentType,
          status,
          orderNo: responseData?.transaction?.order_no ?? "",
          cMail: responseData?.customer?.email ?? "",
          additionalInfo: { comments: transactionComments },
        });
      } catch (err) {
        log.error("CustomObject error", err);
        throw err;
      }

      log.info("[transactionUpdate] Order payment comments synced", {
        orderId,
        ctPaymentId: parsedData.ctPaymentId,
      });
      return {
        paymentReference: responseData?.custom?.paymentRef ?? "",
      };
    } catch (err) {
      log.error("[transactionUpdate] FAILED", err);
      throw err;
    }
  }

  public async createDirectPayment(
    request: CreatePaymentRequest,
  ): Promise<PaymentResponseSchemaDTO> {
    const type = String(request.data?.paymentMethod?.type);
    const config = getConfig();
    const {
      testMode,
      paymentAction,
      dueDate,
      minimumAmount,
      enforce3d,
      displayInline,
      allowb2bCustomers,
      forceNonGuarantee,
    } = getNovalnetConfigValues(type, config);
    await createTransactionCommentsType();
    const ctCart = await this.ctCartService.getCart({
      id: getCartIdFromContext(),
    });

    const deliveryAddress = await this.ctcc(ctCart);
    const billingAddress = await this.ctbb(ctCart);
    const parsedCart = typeof ctCart === "string" ? JSON.parse(ctCart) : ctCart;
    const dueDateValue = getPaymentDueDate(dueDate);
    const lang = String(request.data?.lang ?? "en") as SupportedLocale;
    const orderNumber = getFutureOrderNumberFromContext() ?? "";
    const transaction: Record<string, any> = {
      test_mode: Number(testMode) === 0 ? "0" : "1",
      payment_type: String(request.data.paymentMethod.type),
      amount: String(parsedCart?.taxedPrice?.totalGross?.centAmount),
      currency: String(parsedCart?.taxedPrice?.totalGross?.currencyCode),
      order_no: String(orderNumber),
    };
    const deliveryStreet = this.splitStreetByComma(deliveryAddress?.streetName);
    const billingStreet = this.splitStreetByComma(billingAddress?.streetName);

    const deliveryAddressStreetName = deliveryStreet.streetName;
    const deliveryAddressStreetNumber = deliveryStreet.streetNumber;

    const billingAddressStreetName = billingStreet.streetName;
    const billingAddressStreetNumber = billingStreet.streetNumber;

    if (dueDateValue) {
      transaction.due_date = dueDateValue;
    }

    if (
      ["GUARANTEED_DIRECT_DEBIT_SEPA", "GUARANTEED_INVOICE"].includes(
        String(request.data.paymentMethod.type).toUpperCase(),
      )
    ) {
      const paymentType = String(request.data.paymentMethod.type).toUpperCase();

      const sameAddress =
        billingAddress?.city === deliveryAddress?.city &&
        billingAddress?.country === deliveryAddress?.country &&
        billingAddressStreetName === deliveryAddressStreetName &&
        billingAddressStreetNumber === deliveryAddressStreetNumber &&
        billingAddress?.postalCode === deliveryAddress?.postalCode;

      const billingCountry = billingAddress && billingAddress.country;
      const isEuropean = billingCountry
        ? this.getEuropeanRegionCountryCodes().includes(billingCountry)
        : false;

      const isEur =
        String(parsedCart?.taxedPrice?.totalGross?.currencyCode) === "EUR";

      const orderTotal = Number(
        parsedCart?.taxedPrice?.totalGross?.centAmount ?? 0,
      );
      const minAmount = Number(minimumAmount) || 0;
      const amountValid = orderTotal >= minAmount;

      const countryAllowed =
        allowb2bCustomers &&
        billingCountry &&
        ["DE", "AT", "CH"].includes(billingCountry);

      const guaranteePayment =
        Boolean(sameAddress) &&
        Boolean(isEuropean) &&
        Boolean(isEur) &&
        Boolean(amountValid) &&
        Boolean(countryAllowed);

      const isForceNonGuarantee =
        forceNonGuarantee !== undefined &&
        forceNonGuarantee !== null &&
        !Number.isNaN(Number(forceNonGuarantee)) &&
        Number(forceNonGuarantee) !== 0;
      if (isForceNonGuarantee && guaranteePayment) {
        if (paymentType === "GUARANTEED_DIRECT_DEBIT_SEPA") {
          transaction.payment_type = "DIRECT_DEBIT_SEPA";
        }

        if (paymentType === "GUARANTEED_INVOICE") {
          transaction.payment_type = "INVOICE";
        }
      }
    }

    const company = billingAddress?.additionalAddressInfo ?? "";
    
    let birthDate: string | undefined;
    
    const rawBirthDate =
      request.data.paymentMethod?.birthdate ??
      "";
    
    
    if (typeof rawBirthDate === "string" && rawBirthDate.trim()) {
      birthDate = this.formatBirthDateToYMD(rawBirthDate);
    }

    if (
      String(request.data.paymentMethod.type).toUpperCase() === "DIRECT_DEBIT_SEPA" ||
      String(request.data.paymentMethod.type).toUpperCase() === "GUARANTEED_DIRECT_DEBIT_SEPA"
    ) {
      transaction.payment_data = {
        account_holder: String(request.data.paymentMethod.accHolder),
        iban: String(request.data.paymentMethod.iban),
        bic: String(request.data.paymentMethod.bic ?? ""),
      };
    }
    
    if (
      String(request.data.paymentMethod.type).toUpperCase() ===
      "DIRECT_DEBIT_ACH"
    ) {
      transaction.payment_data = {
        account_holder: String(request.data.paymentMethod.accHolder),
        account_number: String(request.data.paymentMethod.accountNumber),
        routing_number: String(request.data.paymentMethod.routingNumber),
      };
    }
    

    const ctPayment = await this.ctPaymentService.createPayment({
      amountPlanned: await this.ctCartService.getPaymentAmount({
        cart: ctCart,
      }),
      paymentMethodInfo: {
        paymentInterface: getPaymentInterfaceFromContext() || "mock",
      },
      ...(ctCart.customerId && {
        customer: { typeId: "customer", id: ctCart.customerId },
      }),
      ...(!ctCart.customerId &&
        ctCart.anonymousId && {
          anonymousId: ctCart.anonymousId,
        }),
    });

    await this.ctCartService.addPayment({
      resource: { id: ctCart.id, version: ctCart.version },
      paymentId: ctPayment.id,
    });

    const pspReference = randomUUID().toString();
    const processorURL = Context.getProcessorUrlFromContext();
    const sessionId = Context.getCtSessionIdFromContext();

    const hookUrl = new URL(
      "/novalnletWebhook",
      processorURL,
    );
    
    transaction.hook_url = hookUrl.toString();

    if (String(request.data.paymentMethod.type).toUpperCase() === "CREDITCARD") {
      transaction.payment_data = {
        pan_hash: String(
          request.data.paymentMethod.panHash ?? "",
        ),
        unique_id: String(
          request.data.paymentMethod.uniqueId ?? "",
        ),
      };

      if (String(enforce3d) === "1") {
        const {
          returnUrl,
          errorReturnUrl
        } =
          this.createPaymentReturnUrls({
            processorURL,
            sessionId,
            paymentReference: ctPayment.id,
            orderNumber,
            ctPaymentID: ctPayment.id,
            pspReference,
            lang,
            path: String(
              request.data?.path ?? "",
            ),
          });

        transaction.enforce_3d = 1;

        transaction.return_url =
          returnUrl;

        transaction.error_return_url =
          errorReturnUrl;
      }
    }

    let firstName = "";
    let lastName = "";

    if (ctCart.customerId) {
      const customerRes = await projectApiRoot
        .customers()
        .withId({ ID: ctCart.customerId })
        .get()
        .execute();

      const ctCustomer: Customer = customerRes.body;

      firstName = ctCustomer.firstName ?? "";
      lastName = ctCustomer.lastName ?? "";
    } else {
      firstName = ctCart.shippingAddress?.firstName ?? "";
      lastName = ctCart.shippingAddress?.lastName ?? "";
    }

    const novalnetPayload = {
      merchant: {
        signature: String(getConfig()?.novalnetPublicKey),
        tariff: String(getConfig()?.novalnetTariff),
      },
      customer: {
        billing: {
          city: String(billingAddress?.city),
          country_code: String(billingAddress?.country),
          house_no: String(billingAddressStreetNumber),
          street: String(billingAddressStreetName),
          zip: String(billingAddress?.postalCode),
          ...(company && {
            company: company,
          }),
        },
        shipping: {
          city: String(deliveryAddress?.city),
          country_code: String(deliveryAddress?.country),
          house_no: String(deliveryAddressStreetNumber),
          street: String(deliveryAddressStreetName),
          zip: String(deliveryAddress?.postalCode),
        },
        first_name: firstName,
        last_name: lastName,
        email: parsedCart.customerEmail,
        ...(birthDate && {
          birth_date: birthDate,
        }),
      },
      transaction,
      custom: {
        input1: "ctpayment-id",
        inputval1: String(ctPayment.id ?? "ctpayment-id not available"),
        input2: "pspReference",
        inputval2: String(pspReference ?? "0"),
        input3: "lang",
        inputval3: String(lang ?? "lang not available"),
      },
    };

    let paymentActionUrl = "payment";
    
    if (paymentAction?.toLowerCase() === "authorize") {
    
      const orderTotal =
        Number(parsedCart?.taxedPrice?.totalGross?.centAmount ?? 0);
    
      const authorizeAmount =
        Number(minimumAmount ?? 0);

      if (authorizeAmount <= 0) {
    
        paymentActionUrl = "authorize";
    
      } else {
        paymentActionUrl =
          orderTotal >= authorizeAmount
            ? "authorize"
            : "payment";
      }
    }
    
    const url =
      paymentActionUrl === "payment"
        ? "https://payport.novalnet.de/v2/payment"
        : "https://payport.novalnet.de/v2/authorize";
        
    let responseData: any;
    try {
      responseData = await this.callNovalnet(url, novalnetPayload);
    } catch (err) {
      log.error("Failed to process payment with Novalnet:", err);
      throw new Error("Payment processing failed");
    }
    const parsedResponse = responseData;
    if (String(request.data.paymentMethod.type).toUpperCase() === "CREDITCARD" && String(enforce3d) === "1" && parsedResponse?.result?.redirect_url ) {
      log.info("enfore 3D", {
        status: parsedResponse?.result?.status,
        statusText: parsedResponse?.result?.status_text,
        fullResponse: parsedResponse,
      });

      await this.createPendingPaymentTransaction({
        paymentId: ctPayment.id,
        amount: ctPayment.amountPlanned,
        pspReference,
        paymentMethod:
          parsedResponse?.transaction?.payment_type ??
          request.data.paymentMethod.type,
      });

      const redirectUrl = parsedResponse?.result?.redirect_url;
      return {
      paymentReference: ctPayment.id,
      txnSecret: redirectUrl,
      };
    }
    const statusCode = parsedResponse?.transaction?.status_code;
    const status = String(parsedResponse?.transaction?.status ?? "").toUpperCase();
    const { state, transactionType } = this.common.getTransactionStatus(status);
    const transactions = parsedResponse?.transaction;
    const amount = transactions?.amount;
    const tid = transactions?.tid;
    const paymentType = transactions?.payment_type;
    const isTestMode = transactions?.test_mode == 1;
    const bankDetails = transactions?.bank_details;
    const accountHolder = bankDetails?.account_holder;
    const iban = bankDetails?.iban;
    const bic = bankDetails?.bic;
    const bankName = bankDetails?.bank_name;
    const bankPlace = bankDetails?.bank_place;

    const supportedLocales: SupportedLocale[] = ["en", "de"];
    const localizedTransactionComments = supportedLocales.reduce(
      (acc, locale) => {
        acc[locale] = [
          t(locale, "payment.transactionId", { tid }),
          t(locale, "payment.paymentType", { type: paymentType }),
          isTestMode ? t(locale, "payment.testMode") : "",
        ].join("\n");
        return acc;
      },
      {} as Record<SupportedLocale, string>,
    );

    let localizedBankDetailsComment: Partial<Record<SupportedLocale, string>> =
      {};
    if (bankDetails) {
      localizedBankDetailsComment = supportedLocales.reduce(
        (acc, locale) => {
          acc[locale] = [
            t(locale, "payment.referenceText", { amount }),
            t(locale, "payment.accountHolder", { accountHolder }),
            t(locale, "payment.iban", { iban }),
            t(locale, "payment.bic", { bic }),
            t(locale, "payment.bankName", { bankName }),
            t(locale, "payment.bankPlace", { bankPlace }),
            t(locale, "payment.transactionId", { tid }),
          ].join("\n");
          return acc;
        },
        {} as Record<SupportedLocale, string>,
      );
    }

    let transactionComments = localizedTransactionComments[lang];
    if (localizedBankDetailsComment[lang]) {
      transactionComments += `\n\n${localizedBankDetailsComment[lang]}`;
    }

    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      pspReference,
      paymentMethod: request.data.paymentMethod.type,
      transaction: {
        type: transactionType,
        amount: ctPayment.amountPlanned,
        interactionId: pspReference,
        state: state,
        custom: {
          type: {
            typeId: "type",
            key: "novalnet-custom-field",
          },
          fields: {
            transactionComments,
          },
        },
      } as unknown as any,
    } as any);

    const raw = await this.ctPaymentService.getPayment({
      id: ctPayment.id,
    } as any);
    const payment = (raw as any)?.body ?? raw;
    const version = payment.version;
    const tx = payment.transactions?.find(
      (t: any) => t.interactionId === pspReference,
    );
    if (!tx) throw new Error("Transaction not found");
    const txId = tx.id;
    const transactionCommentsText =
      typeof transactionComments === "string"
        ? transactionComments
        : String(transactionComments ?? "");

    const updatedPayment = await projectApiRoot
      .payments()
      .withId({ ID: ctPayment.id })
      .post({
        body: {
          version,
          actions: [
            {
              action: "setStatusInterfaceCode",
              interfaceCode: String(statusCode),
            },
          ],
        },
      })
      .execute();

    const updatedPaymentRoot = await projectApiRoot
      .payments()
      .withId({ ID: ctPayment.id })
      .get()
      .execute();

    const updatedTransaction = updatedPaymentRoot.body.transactions?.find(
      (t) => t.interactionId === pspReference,
    );

    const paymentComment =
      updatedTransaction?.custom?.fields?.transactionComments ??
      transactionCommentsText;
    
    await customObjectService.upsert(
      "nn-private-data",
      `${ctPayment.id}-${pspReference}`,
      {
        paymentId: ctPayment.id,
        pspReference,
        orderNo: parsedResponse?.transaction?.order_no ?? "",
        tid: parsedResponse?.transaction?.tid ?? "",
        paymentMethod: parsedResponse?.transaction?.payment_type ?? "",
        status: parsedResponse?.transaction?.status ?? "",
        amount: parsedResponse?.transaction?.amount ?? "",
        comments: paymentComment,
        email: parsedResponse?.customer?.email ?? "",
      },
    );

    return {
      paymentReference: ctPayment.id,
      novalnetResponse: parsedResponse,
      transactionStatus: parsedResponse?.transaction?.status,
      transactionStatusText: parsedResponse?.transaction?.status_text,
    };
  }

  getEuropeanRegionCountryCodes(): string[] {
    return [
      "AT",
      "BE",
      "BG",
      "CY",
      "CZ",
      "DE",
      "DK",
      "EE",
      "ES",
      "FI",
      "FR",
      "GR",
      "HR",
      "HU",
      "IE",
      "IT",
      "LT",
      "LU",
      "LV",
      "MT",
      "NL",
      "PL",
      "PT",
      "RO",
      "SE",
      "SI",
      "SK",
      "UK",
      "CH",
    ];
  }

  private formatBirthDateToYMD(dateStr: string): string | undefined {
    if (!dateStr) return undefined;
  
    const value = dateStr.trim();
  
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  
    let match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    }
  
    match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    }
  
    match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    }
    
    return undefined;
  }

  public async waitForOrderByPayment(
    paymentId: string,
    retries = 10,
    delayMs = 1500,
  ): Promise<{ id: string; version: number } | null> {
    for (let i = 0; i < retries; i++) {
      const res = await projectApiRoot
        .orders()
        .get({
          queryArgs: {
            where: `paymentInfo(payments(id="${paymentId}"))`,
            limit: 1,
          },
        })
        .execute();

      const order = res.body.results?.[0];
      if (order) return { id: order.id, version: order.version };

      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  private async syncPaymentToOrder(
    paymentId: string,
    pspReference: string,
  ): Promise<void> {
  
    log.info("[ORDER_SYNC] START", {
      paymentId,
      pspReference,
    });
  
    const rawPayment =
      await this.ctPaymentService.getPayment({
        id: paymentId,
      } as any);
  
    const payment = (rawPayment as any)?.body ?? rawPayment;
  
    const transaction = [...(payment.transactions ?? [])]
      .reverse()
      .find((t: any) => t.interactionId === pspReference);
  
    if (!transaction) {
      log.warn("[ORDER_SYNC] Matching transaction not found", {
        paymentId,
        pspReference,
      });
      return;
    }
  
  const orderRef = await this.waitForOrderByPayment(paymentId);
  
  if (!orderRef) {
    log.warn("[ORDER_SYNC] No order linked to payment", {
      paymentId,
      pspReference,
    });
    return;
  }
  
  const orderResponse = await projectApiRoot
    .orders()
    .withId({ ID: orderRef.id })
    .get()
    .execute();
  
  const order = orderResponse.body;
  
    const paymentComment =
      transaction.custom?.fields?.transactionComments ?? "";
  
    log.info("[ORDER_SYNC] Order fetched", {
      orderId: order.id,
      version: order.version,
    });
  
    const orderCommentType = await projectApiRoot
      .types()
      .withKey({ key: "order-payment-comments" })
      .get()
      .execute()
      .catch(() => null);
  
    const actions: any[] = [];
  
    if (orderCommentType) {
  
      actions.push({
        action: "setCustomType",
        type: {
          key: "order-payment-comments",
          typeId: "type",
        },
      });
  
      actions.push({
        action: "setCustomField",
        name: "paymentComments",
        value: paymentComment,
      });
  
      log.info("[ORDER_SYNC] Custom type found", {
        orderId: order.id,
        typeKey: "order-payment-comments",
      });
  
    } else {
  
      log.warn(
        "[ORDER_SYNC] order-payment-comments type not found. Skipping custom field update.",
        {
          orderId: order.id,
          typeKey: "order-payment-comments",
        },
      );
    }
  
    if (actions.length > 0) {
  
      log.info("[ORDER_SYNC] Updating Order", {
        orderId: order.id,
        actions: actions.map(a => a.action),
      });
  
      const updatedOrder = await projectApiRoot
        .orders()
        .withId({ ID: order.id })
        .post({
          body: {
            version: order.version,
            actions,
          },
        })
        .execute();
    }
  
    log.info("[ORDER_SYNC] COMPLETED", {
      orderId: order.id,
      paymentId,
      pspReference,
    });
  }

  private async getOrderByPaymentId(paymentId: string) {
  const result = await projectApiRoot
    .orders()
    .get({
      queryArgs: {
        where: `paymentInfo(payments(id="${paymentId}"))`,
        limit: 1,
      },
    })
    .execute();

  return result.body.results[0] ?? null;
}

private getTransactionStatus(status?: string): {
  state: "Initial" | "Pending" | "Success" | "Failure";
  transactionType:
    | "Authorization"
    | "Charge"
    | "CancelAuthorization";
} {
  switch (String(status ?? "").toUpperCase()) {

    case "PENDING":
    case "ON_HOLD":
      return {
        state: "Pending",
        transactionType: "Authorization",
      };

    case "CONFIRMED":
      return {
        state: "Success",
        transactionType: "Charge",
      };

    case "CANCELLED":
      return {
        state: "Failure",
        transactionType: "CancelAuthorization",
      };

    default:
      return {
        state: "Failure",
        transactionType: "Authorization",
      };
  }
}

  private async callNovalnet<T = any>(url: string, payload: unknown): Promise<T> {
    const accessKey = String(getConfig()?.novalnetPrivateKey ?? "");
  
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-NN-Access-Key": btoa(accessKey),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Novalnet API error: ${response.status}`);
    }

    const responseText = await response.text();
  
    const parsed = JSONbig({ storeAsString: true }).parse(responseText);
  
    return JSON.parse(JSON.stringify(parsed)) as T;
  }

  private getLocalizedComment(
    hook: string,
    lang: SupportedLocale,
    params: Record<string, any>,
  ): string {
    const locale = lang === "en" ? "en" : "de";
    return t(locale, hook, params);
  }

private async updatePaymentTransaction({
  paymentId,
  pspReference,
  transactionComments,
  statusCode,
  state,
  appendComments = true,
  setCustomType = false,
  setStatusInterfaceCode = true,
  changeTransactionState = true,
  errorMessage = "Transaction not found",
}: {
  paymentId: string;
  pspReference: string;
  transactionComments: string;
  statusCode?: string;
  state?: "Initial" | "Pending" | "Success" | "Failure";
  appendComments?: boolean;
  setCustomType?: boolean;
  setStatusInterfaceCode?: boolean;
  changeTransactionState?: boolean;
  errorMessage?: string;
}) {

  const raw =
    await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any);

  const payment = (raw as any)?.body ?? raw;

  const tx = payment.transactions?.find(
    (transaction: any) =>
      transaction.interactionId === pspReference,
  );

  if (!tx?.id) {
    log.error("[PAYMENT_TX] Transaction not found", {
      paymentId,
      pspReference,
    });

    throw new Error(errorMessage);
  }

  const existingComments =
    tx.custom?.fields?.transactionComments ?? "";

  const currentInterfaceCode =
    payment.paymentStatus?.interfaceCode ?? "";

  const alreadyUpdated =
    tx.state === state &&
    currentInterfaceCode === String(statusCode ?? "") &&
    existingComments === transactionComments;

  if (alreadyUpdated) {

    log.info("[PAYMENT_TX] Already updated", {
      paymentId,
      transactionId: tx.id,
    });

    return {
      txId: tx.id,
      comments: existingComments,
    };
  }

  const finalComments =
    appendComments && existingComments
      ? `${existingComments}\n\n---\n${transactionComments}`
      : transactionComments;

  const actions: PaymentUpdateAction[] = [];

  if (setCustomType && !tx.custom?.type) {
    actions.push({
      action: "setTransactionCustomType",
      transactionId: tx.id,
      type: {
        key: "novalnet-custom-field",
        typeId: "type",
      },
    });
  }

  if (existingComments !== finalComments) {
    actions.push({
      action: "setTransactionCustomField",
      transactionId: tx.id,
      name: "transactionComments",
      value: finalComments,
    });
  }
  
  if (
    setStatusInterfaceCode &&
    currentInterfaceCode !== String(statusCode ?? "")
  ) {
    actions.push({
      action: "setStatusInterfaceCode",
      interfaceCode: String(statusCode ?? ""),
    });
  }
  
  if (
    changeTransactionState &&
    state &&
    tx.state !== state
  ) {
    actions.push({
      action: "changeTransactionState",
      transactionId: tx.id,
      state,
    });
  }

    if (actions.length === 0) {
  
    log.info("[PAYMENT_TX] Already synchronized", {
      paymentId,
      transactionId: tx.id,
      transactionState: tx.state,
      interfaceCode: currentInterfaceCode,
    });
  
    return {
      txId: tx.id,
      comments: existingComments,
    };
  }

  log.info("[PAYMENT_TX] Updating Payment", {
    paymentId,
    transactionId: tx.id,
    actions: actions.map(a => a.action),
  });

  await projectApiRoot
    .payments()
    .withId({ ID: paymentId })
    .post({
      body: {
        version: payment.version,
        actions,
      },
    })
    .execute();

  log.info("[PAYMENT_TX] Payment updated", {
    paymentId,
    transactionId: tx.id,
  });

  return {
    txId: tx.id,
    comments: finalComments,
  };
}

private async processWebhookTransaction({
  webhook,
  transactionComments,
  state,
  setStatusInterfaceCode = true,
  changeTransactionState = true,
  skipSettlement = false,
}: {
  webhook: any;
  transactionComments: string;
  state?: "Initial" | "Pending" | "Success" | "Failure";
  setStatusInterfaceCode?: boolean;
  changeTransactionState?: boolean;
  skipSettlement?: boolean;
}) {

  const paymentId =
    webhook.custom?.["ctpayment-id"] ??
    webhook.custom?.inputval1;

  const pspReference =
    webhook.custom?.pspReference ??
    webhook.custom?.inputval2;

  const status = String(
    webhook.transaction?.status ?? "",
  ).toUpperCase();

  const mapped = this.common.getTransactionStatus(status);
  const effectiveState = state ?? mapped.state;

  log.info("[WEBHOOK_TX] START", {
    paymentId,
    pspReference,
    eventType: webhook.event?.type,
    status,
  });

  await this.common.updatePaymentTransaction({
    paymentId,
    pspReference,
    transactionComments,
    statusCode: webhook.transaction?.status_code,
    state: effectiveState,
    setStatusInterfaceCode,
    changeTransactionState,
  });

  if (!skipSettlement &&
      mapped.transactionType !== "CancelAuthorization") {

    log.info("[WEBHOOK_TX] Settlement validation", {
      paymentId,
      transactionType: mapped.transactionType,
    });

    await this.common.addSettlementTransactionIfRequired({
      paymentId,
      pspReference,
      amount: webhook.transaction?.amount,
      currency: webhook.transaction?.currency,
      transactionType: mapped.transactionType,
      status,
    });
  }

  await this.syncPaymentToOrder(paymentId, pspReference);

  log.info("[WEBHOOK_TX] COMPLETED", {
    paymentId,
    pspReference,
  });

  return transactionComments;
}

  
}
