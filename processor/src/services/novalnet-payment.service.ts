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
  constructor(opts: NovalnetPaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService);
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
      const { state, transactionType } = this.getTransactionStatus(status);
      const statusCode = responseData?.transaction?.status_code ?? "";
      const locale = lang === "en" ? "en" : "de";
      const transactionComments = [
        t(locale, "payment.transactionId", { tid }),
        t(locale, "payment.paymentType", { type: paymentType }),
        isTestMode ? t(locale, "payment.testMode") : "",
      ].join("\n");

      const { txId } = await this.updatePaymentTransaction({
        paymentId: parsedData.ctPaymentId,
        pspReference,
        transactionComments,
        statusCode,
        state,
        appendComments: false,
        setCustomType: true,
        errorMessage: "Transaction not found for PSP reference",
      });

      await this.addSettlementTransactionIfRequired({
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
    
    const requestData =
      typeof request.data === "string"
        ? JSON.parse(request.data)
        : request.data;

    log.info("[createDirectPayment] START", {
      paymentMethod: requestData?.paymentMethod?.type,
      paymentOutcome: requestData?.paymentOutcome,
      lang: requestData?.lang,
      path: requestData?.path,
    });

    if (
      requestData?.paymentMethod?.type === "GUARANTEED_DIRECT_DEBIT_SEPA" ||
      requestData?.paymentMethod?.type === "GUARANTEED_INVOICE"
    ) {
      log.info("[Guarantee] Frontend payload", {
        paymentMethod: requestData.paymentMethod.type,
        birthDate: requestData.paymentMethod.birthDate,
        birthdate: requestData.paymentMethod.birthdate,
        ibanPresent: !!requestData.paymentMethod.iban,
        ibanLength: requestData.paymentMethod.iban?.length,
        bicPresent: !!requestData.paymentMethod.bic,
        accHolderPresent: !!requestData.paymentMethod.accHolder,
      });
    }

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

    log.info("[createDirectPayment] Cart loaded", {
      cartId: ctCart.id,
      customerId: ctCart.customerId,
      anonymousId: ctCart.anonymousId,
      totalAmount: ctCart.taxedPrice?.totalGross?.centAmount,
      currency: ctCart.taxedPrice?.totalGross?.currencyCode,
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

      /* ================= Address check ================= */
      const sameAddress =
        billingAddress?.city === deliveryAddress?.city &&
        billingAddress?.country === deliveryAddress?.country &&
        billingAddressStreetName === deliveryAddressStreetName &&
        billingAddressStreetNumber === deliveryAddressStreetNumber &&
        billingAddress?.postalCode === deliveryAddress?.postalCode;

      /* ================= Country check ================= */
      const billingCountry = billingAddress && billingAddress.country;
      const isEuropean = billingCountry
        ? this.getEuropeanRegionCountryCodes().includes(billingCountry)
        : false;

      /* ================= Currency check ================= */
      const isEur =
        String(parsedCart?.taxedPrice?.totalGross?.currencyCode) === "EUR";

      /* ================= Amount check ================= */
      const orderTotal = Number(
        parsedCart?.taxedPrice?.totalGross?.centAmount ?? 0,
      );
      const minAmount = Number(minimumAmount) || 0;
      const amountValid = orderTotal >= minAmount;
      /* ================= B2B country check ================= */
      const countryAllowed =
        allowb2bCustomers &&
        billingCountry &&
        ["DE", "AT", "CH"].includes(billingCountry);

      /* ================= FINAL DECISION ================= */
      const guaranteePayment =
        Boolean(sameAddress) &&
        Boolean(isEuropean) &&
        Boolean(isEur) &&
        Boolean(amountValid) &&
        Boolean(countryAllowed);

      /* ================= Force non-guarantee ================= */
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

      log.info("[Guarantee] Eligibility check", {
        paymentMethod: requestData.paymentMethod.type,
        sameAddress,
        isEuropean,
        isEur,
        orderTotal,
        minimumAmount: minAmount,
        amountValid,
        countryAllowed,
        guaranteePayment,
        forceNonGuarantee,
      });
    }

    const company = billingAddress?.additionalAddressInfo ?? "";
    
    let birthDate: string | undefined;
    
    const rawBirthDate =
      requestData.paymentMethod?.birthDate ??
      requestData.paymentMethod?.birthdate;
    
    log.info("[Guarantee] DOB received", {
      rawBirthDate,
    });
    
    if (typeof rawBirthDate === "string" && rawBirthDate.trim()) {
      birthDate = this.formatBirthDateToYMD(rawBirthDate);
    }
    
    log.info("[Guarantee] DOB formatted", {
      birthDate,
    });

    if (
      String(request.data.paymentMethod.type).toUpperCase() === "DIRECT_DEBIT_SEPA" ||
      String(request.data.paymentMethod.type).toUpperCase() === "GUARANTEED_DIRECT_DEBIT_SEPA"
    ) {
      transaction.payment_data = {
        account_holder: String(requestData.paymentMethod.accHolder),
        iban: String(requestData.paymentMethod.iban),
        bic: String(requestData.paymentMethod.bic ?? ""),
      };
    
      log.info("[Guarantee] SEPA payment data", {
        accountHolderPresent: !!requestData.paymentMethod.accHolder,
        ibanLength: requestData.paymentMethod.iban?.length,
        bicPresent: !!requestData.paymentMethod.bic,
      });
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
    
    log.info("[CT] Creating payment", {
      paymentMethod: requestData.paymentMethod.type,
      amount: ctCart.taxedPrice?.totalGross?.centAmount,
    });

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
        signature: String(getConfig()?.novalnetPrivateKey),
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

    const debugPayload = JSON.parse(JSON.stringify(novalnetPayload));

    if (debugPayload?.transaction?.payment_data?.iban) {
      const iban = debugPayload.transaction.payment_data.iban;
      debugPayload.transaction.payment_data.iban =
        iban.slice(0, 4) +
        "********" +
        iban.slice(-4);
    }

    log.info("[Novalnet] Outgoing payload", {
      paymentMethod: transaction.payment_type,
      payload: debugPayload,
    });

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

      log.info("[Novalnet] Calling API", {
        url,
        paymentMethod: transaction.payment_type,
      });

      responseData = await this.callNovalnet(url, novalnetPayload);
      log.info("[Novalnet] Raw response", {
      paymentMethod: transaction.payment_type,
      resultStatus: responseData?.result?.status,
      resultStatusCode: responseData?.result?.status_code,
      resultStatusText: responseData?.result?.status_text,
      transactionStatus: responseData?.transaction?.status,
      transactionStatusCode: responseData?.transaction?.status_code,
      transactionStatusText: responseData?.transaction?.status_text,
      tid: responseData?.transaction?.tid,
    });

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
    const { state, transactionType } = this.getTransactionStatus(status);
    log.info("[CT] Transaction mapping", {
      paymentMethod: transaction.payment_type,
      novalnetStatus: status,
      mappedState: state,
      mappedType: transactionType,
    });
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

    log.info("[CT] Updating payment", {
      paymentId: ctPayment.id,
      pspReference,
      transactionType,
      state,
    });

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

    // Re-read payment to ensure transactionComments is persisted
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
    // Store for later Order sync (because Order does NOT exist yet)

    log.info("[CustomObject] Saving payment snapshot", {
      paymentId: ctPayment.id,
      tid,
      paymentType,
      status,
    });
    
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

    log.info("[createDirectPayment] END", {
      paymentReference: ctPayment.id,
      transactionStatus: parsedResponse?.transaction?.status,
      transactionStatusText: parsedResponse?.transaction?.status_text,
      tid,
    });
    
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

  private async syncPaymentToOrder(paymentId: string, pspReference: string) {
    // 1. Wait for Order to exist
    const order = await this.waitForOrderByPayment(paymentId);

    if (!order) {
      log.warn("Order not found yet – will sync on next webhook", {
        paymentId,
        pspReference,
      });
      return;
    }

    // 2. Load Payment
    const paymentRes = await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .get()
      .execute();

    const payment = paymentRes.body;

    const tx = payment.transactions?.find(
      (t) => t.interactionId === pspReference,
    );

    if (!tx) {
      log.warn("Transaction not found for PSP reference", {
        paymentId,
        pspReference,
      });
      return;
    }

    const comment = tx.custom?.fields?.transactionComments;
    if (!comment) return;

    // 3. Write into Order
    await projectApiRoot
      .orders()
      .withId({ ID: order.id })
      .post({
        body: {
          version: order.version,
          actions: [
            {
              action: "setCustomType",
              type: {
                key: "order-payment-comments",
                typeId: "type",
              },
            },
            {
              action: "setCustomField",
              name: "paymentComments",
              value: comment,
            },
          ],
        },
      })
      .execute();

    log.info("Payment comments synced to Order", {
      orderId: order.id,
      paymentId,
    });
  }

  private getTransactionStatus(status?: string): {
    state: "Initial" | "Pending" | "Success" | "Failure";
    transactionType: "Authorization" | "Charge" | "CancelAuthorization";
  } {
    switch (String(status ?? "").toUpperCase()) {
      case "PENDING":
      case "ON_HOLD":
        return { state: "Pending", transactionType: "Authorization" };
      case "CONFIRMED":
        return { state: "Success", transactionType: "Charge" };
      case "CANCELLED":
        return { state: "Failure", transactionType: "CancelAuthorization" };
      default:
        return { state: "Failure", transactionType: "Authorization" };
    }
  }

  private async callNovalnet<T = any>(url: string, payload: unknown): Promise<T> {
    const accessKey = String(getConfig()?.novalnetPublicKey ?? "");
  
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
    const raw = await this.ctPaymentService.getPayment({ id: paymentId } as any);
    const payment = (raw as any)?.body ?? raw;
    const tx = payment.transactions?.find(
      (transaction: any) => transaction.interactionId === pspReference,
    );

    if (!tx?.id) {
      throw new Error(errorMessage);
    }

    const existingComments = tx.custom?.fields?.transactionComments ?? "";
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

    actions.push({
      action: "setTransactionCustomField",
      transactionId: tx.id,
      name: "transactionComments",
      value: finalComments,
    });

    if (setStatusInterfaceCode) {
      actions.push({
        action: "setStatusInterfaceCode",
        interfaceCode: String(statusCode ?? ""),
      });
    }

    if (changeTransactionState && state) {
      actions.push({
        action: "changeTransactionState",
        transactionId: tx.id,
        state,
      });
    }

    await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .post({ body: { version: payment.version, actions } })
      .execute();

    return { txId: tx.id, comments: finalComments };
  }

  private async processWebhookTransaction({
    webhook,
    transactionComments,
    state,
    setStatusInterfaceCode = true,
    changeTransactionState = true,
  }: {
    webhook: any;
    transactionComments: string;
    state?: "Initial" | "Pending" | "Success" | "Failure";
    setStatusInterfaceCode?: boolean;
    changeTransactionState?: boolean;
  }) {
    const paymentId = webhook?.custom?.inputval1;
    const pspReference = webhook?.custom?.inputval2;

    const status = String(webhook?.transaction?.status ?? "").toUpperCase();
    const mapped = this.getTransactionStatus(status);
    const effectiveState = state ?? mapped.state;

    await this.updatePaymentTransaction({
      paymentId,
      pspReference,
      transactionComments,
      statusCode: webhook?.transaction?.status_code,
      state: effectiveState,
      setStatusInterfaceCode,
      changeTransactionState,
    });

    if (changeTransactionState) {
      await this.addSettlementTransactionIfRequired({
        paymentId,
        pspReference,
        amount: webhook?.transaction?.amount,
        currency: webhook?.transaction?.currency,
        transactionType: mapped.transactionType,
        status,
      });
    }

    await this.syncPaymentToOrder(paymentId, pspReference);
    return transactionComments;
  }

  public async createWebhook(
  webhookData: any[],
  req?: FastifyRequest,
): Promise<any> {

  if (!Array.isArray(webhookData) || webhookData.length === 0) {
    log.error("Invalid webhook payload");
    throw new Error("Invalid webhook payload");
  }

  const webhook = webhookData[0];

  await this.validateRequiredParameters(webhook);
    
  await this.validateChecksum(webhook);

  if (req) {
    //await this.validateIpAddress(req);
  }

  log.info("Resolving order details", {
    orderNo: webhook.transaction?.order_no,
    paymentReference: webhook.custom?.["ctpayment-id"],
  });

  await this.getOrderDetails(webhook);
  
  log.info("Order details resolved");
  
  const eventType = String(webhook.event?.type ?? "").toUpperCase();
  const status = String(webhook.result?.status ?? "").toUpperCase();

  log.info("Processing Novalnet webhook", {
    eventType,
    status,
    tid: webhook?.event?.tid,
    paymentType: webhook?.transaction?.payment_type,
  });

  if (status !== "SUCCESS") {

    log.warn("Webhook ignored (non-success)", {
      eventType,
      status,
      tid: webhook?.event?.tid,
    });

    return {
      success: true,
      message: "Webhook ignored (non-success)",
    };
  }

  let transactionComments: string | undefined;

  switch (eventType) {

    case "PAYMENT":
      transactionComments = await this.handlePayment(webhook);
      break;

    case "TRANSACTION_CAPTURE":
      transactionComments = await this.handleTransactionCapture(webhook);
      break;

    case "TRANSACTION_CANCEL":
      transactionComments = await this.handleTransactionCancel(webhook);
      break;

    case "TRANSACTION_REFUND":
      transactionComments = await this.handleTransactionRefund(webhook);
      break;

    case "TRANSACTION_UPDATE":
      transactionComments = await this.handleTransactionUpdate(webhook);
      break;

    case "CREDIT":
      transactionComments = await this.handleCredit(webhook);
      break;

    case "CHARGEBACK":
      transactionComments = await this.handleChargeback(webhook);
      break;

    case "PAYMENT_REMINDER_1":
    case "PAYMENT_REMINDER_2":
      transactionComments = await this.handlePaymentReminder(webhook);
      break;

    case "SUBMISSION_TO_COLLECTION_AGENCY":
      transactionComments = await this.handleCollectionSubmission(webhook);
      break;

    default:

      log.warn("Unhandled Novalnet event type", {
        eventType,
        tid: webhook?.event?.tid,
      });

      return {
        success: true,
        skipped: true,
        eventType,
      };
  }

  log.info("Webhook processed", {
    eventType,
    tid: webhook?.event?.tid,
  });

  return {
    success: true,
    eventType,
    message: transactionComments,
  };
}

  private async handlePayment(
    webhook: Record<string, any>,
  ): Promise<string> {
  
    const paymentId =
      webhook.custom?.["ctpayment-id"] ??
      webhook.custom?.inputval1;
  
    const pspReference =
      webhook.custom?.pspReference ??
      webhook.custom?.inputval2;
  
    const tid = String(webhook.event?.tid ?? "");
  
    if (!paymentId || !pspReference) {
      throw new Error("Missing payment reference");
    }
  
    log.info("[PAYMENT] Start", {
      paymentId,
      pspReference,
      tid,
      eventType: webhook.event?.type,
      paymentType: webhook.transaction?.payment_type,
      status: webhook.transaction?.status,
    });
  
    const payment = (
      await projectApiRoot
        .payments()
        .withId({ ID: paymentId })
        .get()
        .execute()
    ).body;
  
    log.info("[PAYMENT] Payment fetched", {
      paymentId,
      version: payment.version,
      interfaceId: payment.interfaceId,
      transactionCount: payment.transactions?.length ?? 0,
    });
  
    const transaction = [...(payment.transactions ?? [])]
      .reverse()
      .find(tx => tx.interactionId === pspReference);
  
    if (!transaction) {
  
      log.warn("[PAYMENT] Matching transaction not found", {
        paymentId,
        pspReference,
        availableInteractionIds:
          payment.transactions?.map(tx => tx.interactionId),
      });
  
      return "Transaction not found";
    }
  
    log.info("[PAYMENT] Transaction located", {
      transactionId: transaction.id,
      type: transaction.type,
      currentState: transaction.state,
      interactionId: transaction.interactionId,
    });
  
    const currentState = transaction.state;
  
    const novalnetStatus =
      String(webhook.transaction?.status ?? "").toUpperCase();
  
    let targetState: "Success" | "Pending" | "Failure";
  
    switch (novalnetStatus) {
  
      case "CONFIRMED":
        targetState = "Success";
        break;
  
      case "FAILURE":
        targetState = "Failure";
        break;
  
      default:
        targetState = "Pending";
        break;
    }
  
    log.info("[PAYMENT] State mapping", {
      novalnetStatus,
      currentState,
      targetState,
    });
  
    const transactionComments =
      this.buildTransactionComments(webhook);
  
    const actions: any[] = [];
  
    // Set interfaceId only once
    if (!payment.interfaceId) {
  
      actions.push({
        action: "setInterfaceId",
        interfaceId: tid,
      });
    }
  
    // Synchronize transaction state
    if (currentState !== targetState) {
  
      actions.push({
        action: "changeTransactionState",
        transactionId: transaction.id,
        state: targetState,
      });
    }
  
    // Update transaction comments only if custom exists
    if (
      transaction.custom &&
      transaction.custom?.fields?.transactionComments !==
        transactionComments
    ) {
  
      actions.push({
        action: "setTransactionCustomField",
        transactionId: transaction.id,
        name: "transactionComments",
        value: transactionComments,
      });
    }
  
    // Always synchronize interface status code
    actions.push({
      action: "setStatusInterfaceCode",
      interfaceCode: String(
        webhook.transaction?.status_code ?? "",
      ),
    });
  
    log.info("[PAYMENT] Prepared actions", {
      paymentId,
      actions: actions.map(a => a.action),
    });
  
    if (actions.length === 0) {
  
      log.info("[PAYMENT] Already synchronized", {
        paymentId,
        tid,
      });
  
      return "Already synchronized";
    }
  
    const updated =
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
  
    log.info("[PAYMENT] Payment updated", {
      paymentId,
      newVersion: updated.body.version,
    });
  
    await customObjectService.upsert(
      "nn-private-data",
      `${paymentId}-${pspReference}`,
      {
        paymentId,
        pspReference,
        orderNo: webhook.transaction?.order_no ?? "",
        tid,
        paymentMethod: webhook.transaction?.payment_type ?? "",
        status: novalnetStatus,
        amount: webhook.transaction?.amount ?? "",
        comments: transactionComments,
        email: webhook.customer?.email ?? "",
      },
    );
  
    log.info("[PAYMENT] CustomObject synchronized", {
      paymentId,
      key: `${paymentId}-${pspReference}`,
    });
  
    try {
  
      const orderId =
        await this.getOrderIdFromOrderNumber(
          webhook.transaction?.order_no,
        );
  
      if (orderId) {
  
        await this.updateOrderComments(orderId);
  
        log.info("[PAYMENT] Order synchronized", {
          orderId,
        });
  
      } else {
  
        log.warn("[PAYMENT] Order not found", {
          orderNumber: webhook.transaction?.order_no,
        });
      }
  
    } catch (err) {
  
      log.error("[PAYMENT] Order synchronization failed", err);
    }
  
    log.info("[PAYMENT] Completed", {
      paymentId,
      tid,
    });
  
    return `PAYMENT synchronized (${targetState})`;
  }

  private async handleTransactionCapture(
    webhook: Record<string, any>,
  ): Promise<string> {
  
    const paymentId =
      webhook.custom?.["ctpayment-id"] ??
      webhook.custom?.inputval1;
  
    const pspReference =
      webhook.custom?.pspReference ??
      webhook.custom?.inputval2;
  
    const tid = String(webhook.event?.tid ?? "");
  
    log.info("[CAPTURE] Start", {
      paymentId,
      pspReference,
      tid,
      novalnetStatus: webhook.transaction?.status,
    });
  
    if (!paymentId || !pspReference) {
      throw new Error("Missing payment reference");
    }
  
    const payment = (
      await projectApiRoot
        .payments()
        .withId({ ID: paymentId })
        .get()
        .execute()
    ).body;
  
    const authorizationTx = payment.transactions?.find(
      tx => tx.interactionId === pspReference,
    );
  
    if (!authorizationTx) {
  
      log.warn("[CAPTURE] Authorization transaction not found", {
        paymentId,
        pspReference,
      });
  
      return "Authorization transaction not found";
    }
  
    const existingChargeTx = payment.transactions?.find(
      tx =>
        tx.type === "Charge" &&
        tx.interactionId === tid,
    );
  
    log.info("[CAPTURE] Current transaction status", {
      authorizationId: authorizationTx.id,
      authorizationType: authorizationTx.type,
      authorizationState: authorizationTx.state,
      chargeExists: !!existingChargeTx,
      chargeState: existingChargeTx?.state,
    });
  
    if (
      existingChargeTx &&
      existingChargeTx.state === "Success"
    ) {
  
      log.info("[CAPTURE] Already captured - skipping", {
        paymentId,
        chargeTransactionId: existingChargeTx.id,
        tid,
      });
  
      return "Already captured";
    }
  
    const actions: any[] = [];
  
    if (authorizationTx.state !== "Success") {
  
      actions.push({
        action: "changeTransactionState",
        transactionId: authorizationTx.id,
        state: "Success",
      });
    }
    
    if (!existingChargeTx) {
  
      actions.push({
        action: "addTransaction",
        transaction: {
          type: "Charge",
          amount: authorizationTx.amount,
          interactionId: tid,
          state: "Success",
          custom: authorizationTx.custom,
        },
      });
    }
  
    actions.push({
      action: "setStatusInterfaceCode",
      interfaceCode: String(
        webhook.transaction?.status_code ?? "",
      ),
    });
  
    if (actions.length === 1) {
  
      log.info("[CAPTURE] Nothing to update", {
        paymentId,
        tid,
      });
  
      return "Already captured";
    }
  
    const result =
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
  
    const createdCharge = result.body.transactions?.find(
      tx =>
        tx.type === "Charge" &&
        tx.interactionId === tid,
    );
  
    log.info("[CAPTURE] Completed", {
      paymentId,
      authorizationTransactionId: authorizationTx.id,
      chargeTransactionId: createdCharge?.id,
      version: result.body.version,
      tid,
    });
  
    return "Capture processed";
  }

  private async handleTransactionCancel(
    webhook: Record<string, any>,
  ): Promise<string> {
  
    const paymentId =
      webhook.custom?.["ctpayment-id"] ??
      webhook.custom?.inputval1;
  
    const pspReference =
      webhook.custom?.pspReference ??
      webhook.custom?.inputval2;
  
    const tid = String(webhook.event?.tid ?? "");
  
    log.info("[CANCEL] Start", {
      paymentId,
      pspReference,
      tid,
    });
  
    const paymentResponse = await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .get()
      .execute();
  
    const payment = paymentResponse.body;
  
    const transaction = payment.transactions?.find(
      tx => tx.interactionId === pspReference,
    );
  
    if (!transaction) {
  
      log.warn("[CANCEL] Transaction not found", {
        paymentId,
        pspReference,
      });
  
      return "Cancel transaction not found";
    }
  
    if (transaction.state !== "Pending") {
  
      log.warn("[CANCEL] Invalid transaction state", {
        currentState: transaction.state,
        transactionId: transaction.id,
      });
  
      return `Cancel skipped (${transaction.state})`;
    }
  
    const updatedPayment = await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .post({
        body: {
          version: payment.version,
          actions: [
            {
              action: "changeTransactionState",
              transactionId: transaction.id,
              state: "Failure",
            },
            {
              action: "setStatusInterfaceCode",
              interfaceCode: String(
                webhook.transaction?.status_code ?? "",
              ),
            },
          ],
        },
      })
      .execute();
  
    log.info("[CANCEL] Payment updated", {
      paymentId,
      transactionId: transaction.id,
      version: updatedPayment.body.version,
    });
  
    await customObjectService.upsert(
      "nn-private-data",
      `${paymentId}-${pspReference}`,
      {
        paymentId,
        pspReference,
        orderNo: webhook.transaction?.order_no ?? "",
        tid,
        paymentMethod: webhook.transaction?.payment_type ?? "",
        status: "FAILURE",
        amount: webhook.transaction?.amount ?? "",
        email: webhook.customer?.email ?? "",
        comments: "CANCEL processed (Failure)",
      },
    );
  
    log.info("[CANCEL] Custom object updated", {
      paymentId,
      tid,
    });
  
    return "CANCEL processed (Failure)";
  }

  public async handleTransactionRefund(webhook: any) {
    const eventTID = webhook.event.tid;
    const currency = webhook.transaction.currency;
    const refundedAmount = webhook.transaction.refund.amount;
    const refundTID = webhook.transaction.refund.tid ?? "";
    const lang = webhook.custom.lang as SupportedLocale;

    const transactionComments = refundTID
      ? this.getLocalizedComment("webhook.refundTIDComment", lang, {
          eventTID,
          refundedAmount,
          currency,
          refundTID,
        })
      : this.getLocalizedComment("webhook.refundComment", lang, {
          eventTID,
          refundedAmount,
          currency,
        });

    return this.processWebhookTransaction({
      webhook,
      transactionComments,
      setStatusInterfaceCode: true,
      changeTransactionState: false,
    });
  }


  public async handleTransactionUpdate(webhook: any) {
    const eventTID = webhook.event.tid;
    const amount = String(webhook.transaction.amount / 100);
    const currency = webhook.transaction.currency;
    const dueDate = webhook.transaction.due_date;
    const { date, time } = this.getFormattedDateTime();
    const lang = webhook.custom.lang;

    const amountUpdateComment = await this.localcomments(
      "webhook.amountUpdateComment",
      { eventTID: eventTID, amount: amount, currency: currency },
    );
    const dueDateUpdateComment = await this.localcomments(
      "webhook.dueDateUpdateComment",
      {
        eventTID: eventTID,
        amount: amount,
        currency: currency,
        dueDate: dueDate,
      },
    );

    const orderDetails = await this.getOrderDetails(webhook);
    let transactionComments = "";
    if (
      ["DUE_DATE", "AMOUNT", "AMOUNT_DUE_DATE"].includes(
        webhook.transaction.update_type,
      )
    ) {
      transactionComments =
        lang == "en" ? amountUpdateComment.en : amountUpdateComment.de;
      if (webhook.transaction.due_date) {
        const dueDate = webhook.transaction.due_date;
        transactionComments =
          lang == "en" ? dueDateUpdateComment.en : dueDateUpdateComment.de;
      }
    }

    const pendingToComplete = await this.localcomments(
      "webhook.pendingToComplete",
      { eventTID: eventTID, date: date, time: time },
    );
    const onholdToComplete = await this.localcomments(
      "webhook.onholdToComplete",
      { eventTID: eventTID, date: date, time: time },
    );
    const confirmComments = await this.localcomments("webhook.confirmComment", {
      date,
      time,
    });
    const cancelComments = await this.localcomments("webhook.cancelComment", {
      date,
      time,
    });

    if (
      orderDetails.status != webhook.transaction.status &&
      ["PENDING", "ON_HOLD"].includes(orderDetails.status)
    ) {
      if (webhook.transaction.status === "CONFIRMED") {
        transactionComments =
          lang == "en" ? pendingToComplete.en : pendingToComplete.de;
      } else if (webhook.transaction.status === "ON_HOLD") {
        transactionComments =
          lang == "en" ? onholdToComplete.en : onholdToComplete.de;
      } else {
        transactionComments =
          lang == "en" ? cancelComments.en : cancelComments.de;
      }
    } else if (orderDetails.status === "ON_HOLD") {
      if (webhook.transaction.status === "CONFIRMED") {
        transactionComments =
          lang == "en" ? confirmComments.en : confirmComments.de;
      } else {
        transactionComments =
          lang == "en" ? cancelComments.en : cancelComments.de;
      }
    }

    await this.processWebhookTransaction({
      webhook,
      transactionComments,
      state: this.getTransactionStatus(webhook?.transaction?.status).state,
      setStatusInterfaceCode: true,
    });
    return transactionComments;
  }

  public async handleCredit(webhook: any) {
    const eventTID = webhook.event.tid;
    const transactionID = webhook.transaction.tid;
    const parentTID = webhook.event.parent_tid ?? eventTID;
    const amount = String(webhook.transaction.amount / 100);
    const currency = webhook.transaction.currency;
    const { date, time } = this.getFormattedDateTime();
    const lang = webhook.custom.lang as SupportedLocale;

    const transactionComments = this.getLocalizedComment("webhook.creditComment", lang, {
      parentTID,
      amount,
      currency,
      date,
      time,
      transactionID,
    });

    return this.processWebhookTransaction({
      webhook,
      transactionComments,
      state: this.getTransactionStatus(webhook?.transaction?.status).state,
      setStatusInterfaceCode: true,
    });
  }

  public async handleChargeback(webhook: any) {
    const eventTID = webhook.event.tid;
    const transactionID = webhook.transaction.tid;
    const parentTID = webhook.event.parent_tid ?? eventTID;
    const amount = String(webhook.transaction.amount / 100);
    const currency = webhook.transaction.currency;
    const { date, time } = this.getFormattedDateTime();
    const lang = webhook.custom.lang as SupportedLocale;

    const transactionComments = this.getLocalizedComment("webhook.chargebackComment", lang, {
      parentTID,
      amount,
      currency,
      date,
      time,
      eventTID,
    });

    return this.processWebhookTransaction({
      webhook,
      transactionComments,
      state: this.getTransactionStatus(webhook?.transaction?.status).state,
      setStatusInterfaceCode: true,
    });
  }


  public async handlePaymentReminder(webhook: any) {
    const reminderIndex = webhook.event.type.split("_")[2];
    const lang = webhook.custom.lang as SupportedLocale;
    const transactionComments = this.getLocalizedComment(
      "webhook.paymentRemainderComment",
      lang,
      { reminderIndex },
    );

    return this.processWebhookTransaction({
      webhook,
      transactionComments,
      setStatusInterfaceCode: false,
      changeTransactionState: false,
    });
  }

  public async handleCollectionSubmission(webhook: any) {
    const reminderIndex = webhook.event.type.split("_")[2];
    const lang = webhook.custom.lang as SupportedLocale;
    const transactionComments = this.getLocalizedComment(
      "webhook.collectionSubmissionComment",
      lang,
      { reminderIndex },
    );

    return this.processWebhookTransaction({
      webhook,
      transactionComments,
      setStatusInterfaceCode: false,
      changeTransactionState: false,
    });
  }

  public async validateRequiredParameters(payload: any) {
    const mandatory: Record<string, string[]> = {
      event: ["type", "checksum", "tid"],
      merchant: ["vendor", "project"],
      result: ["status"],
      transaction: ["tid", "payment_type", "status"],
    };
    for (const category of Object.keys(mandatory)) {
      if (!payload[category]) {
        throw new Error(`Missing category: ${category}`);
      }

      for (const param of mandatory[category]) {
        if (!payload[category][param]) {
          log.info(`Missing parameter ${param} in ${category}`);
          throw new Error(`Missing parameter ${param} in ${category}`);
        }
      }
    }
  }

public async validateIpAddress(
  req: FastifyRequest
): Promise<void> {

  const webhookTestMode =
    String(getConfig()?.novalnetWebhookTestMode);

  if (webhookTestMode === "1") {
    return;
  }

  const novalnetHostIPs =
    await dns.resolve4("pay-nn.de");

  if (!novalnetHostIPs.length) {

    log.error("Novalnet HOST IP missing");

    throw new Error("Novalnet HOST IP missing");
  }

  const isAuthorized =
    this.validateRequestIp(req, novalnetHostIPs);

  if (!isAuthorized) {

    log.warn("Unauthorized webhook IP", {
      requestIp: req.ip,
      forwardedFor: req.headers["x-forwarded-for"],
      realIp: req.headers["x-real-ip"],
      allowedIps: novalnetHostIPs,
    });

    throw new Error(
      `Unauthorized access from IP ${req.ip}`
    );
  }
}

  private validateRequestIp(
    req: FastifyRequest,
    novalnetHostIPs: string[]
  ): boolean {
  
    const headers = req.headers;
  
    const remoteAddrHeaders = [
      "x-forwarded-host",
      "x-client-ip",
      "x-real-ip",
      "x-forwarded-for",
      "x-forwarded",
      "x-cluster-client-ip",
      "forwarded-for",
      "forwarded",
    ];
  
    for (const header of remoteAddrHeaders) {
  
      const value = headers[header] as string | undefined;
  
      if (!value) {
        continue;
      }
  
      const headerValues =
        value.split(",").map(v => v.trim());
  
      if (
        headerValues.some(ip => novalnetHostIPs.includes(ip))
      ) {
        return true;
      }
    }
  
    return novalnetHostIPs.includes(req.ip);
  }

  private async validateChecksum(
    webhook: Record<string, any>,
  ): Promise<void> {
  
    let checksumString =
      String(webhook.event?.tid ?? "") +
      String(webhook.event?.type ?? "") +
      String(webhook.result?.status ?? "");
  
    if (webhook.transaction?.amount !== undefined) {
      checksumString += String(webhook.transaction.amount);
    }
  
    if (webhook.transaction?.currency) {
      checksumString += String(webhook.transaction.currency);
    }
  
    const accessKey = String(
      getConfig()?.novalnetPublicKey ?? ""
    ).trim();
  
    if (accessKey) {
      checksumString += accessKey.split("").reverse().join("");
    }
  
    const generatedChecksum = crypto
      .createHash("sha256")
      .update(checksumString)
      .digest("hex");
  
    log.info("[CHECKSUM] Validation", {
      tid: webhook.event?.tid,
      eventType: webhook.event?.type,
      status: webhook.result?.status,
      amount: webhook.transaction?.amount,
      currency: webhook.transaction?.currency,
      keyLength: accessKey.length,
      generatedChecksum,
      receivedChecksum: webhook.event?.checksum,
      matched: generatedChecksum === webhook.event?.checksum,
    });
  
    if (generatedChecksum !== webhook.event?.checksum) {
  
      log.error("[CHECKSUM] Validation failed", {
        checksumString,
        generatedChecksum,
        receivedChecksum: webhook.event?.checksum,
      });
  
      throw new Error("Checksum validation failed");
    }
  
    log.info("[CHECKSUM] Validation successful", {
      tid: webhook.event?.tid,
    });
  }
  
  public async getOrderDetails(payload: any) {
    const paymentIdValue = payload.custom.inputval1;
    const pspReference = payload.custom.inputval2;
    const container = "nn-private-data";
    const key = `${paymentIdValue}-${pspReference}`;
    const obj = await customObjectService.get(container, key);
    if (!obj) {
      log.warn("CustomObject missing after upsert (unexpected)", {
        container,
        key,
      });
      return {};
    }
    return obj.value;
  }

  public async updatePaymentStatusByPaymentId(
    paymentId: string,
    transactionId: string,
    newState: "Initial" | "Pending" | "Success" | "Failure",
  ) {
    const paymentRes = await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .get()
      .execute();

    const payment = paymentRes.body;

    const updatedPayment = await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .post({
        body: {
          version: payment.version,
          actions: [
            {
              action: "changeTransactionState",
              transactionId,
              state: newState,
            },
          ],
        },
      })
      .execute();

    return updatedPayment.body;
  }

  public async getTransactionComment(paymentId: string, pspReference: string) {
    const response = await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .get()
      .execute();
    const payment = response.body;
    const tx = payment.transactions?.find(
      (t: any) =>
        t.interactionId === pspReference ||
        String(t.interactionId) === String(pspReference),
    );

    if (!tx) throw new Error("Transaction not found");
    const comment = tx.custom?.fields?.transactionComments ?? null;

    return comment;
  }

  public getFormattedDateTime(): { date: string; time: string } {
    const now = new Date();
    return {
      date: now.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      time: now.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    };
  }

public async createRedirectPayment(
  request: CreatePaymentRequest,
): Promise<PaymentResponseSchemaDTO> {
  const type = String(
    request.data?.paymentMethod?.type,
  );

  const lang = String(
    request.data?.lang ?? "en",
  );

  const path = String(
    request.data?.path ?? "",
  );

  const config = getConfig();

  await createTransactionCommentsType();

  const {
    testMode,
    paymentAction,
    enforce3d,
  } = getNovalnetConfigValues(
    type,
    config,
  );

  const cartId =
    getCartIdFromContext();

  const ctCart =
    await this.ctCartService.getCart({
      id: cartId,
    });

  const deliveryAddress =
    await this.ctcc(ctCart);

  const billingAddress =
    await this.ctbb(ctCart);

  const parsedCart =
    typeof ctCart === "string"
      ? JSON.parse(ctCart)
      : ctCart;

  const processorURL =
    Context.getProcessorUrlFromContext();

  const sessionId =
    Context.getCtSessionIdFromContext();

  const paymentAmount =
    await this.ctCartService.getPaymentAmount({
      cart: ctCart,
    });

  const deliveryStreet =
    this.splitStreetByComma(
      deliveryAddress?.streetName,
    );

  const billingStreet =
    this.splitStreetByComma(
      billingAddress?.streetName,
    );

  const deliveryAddressStreetName =
    deliveryStreet.streetName;

  const deliveryAddressStreetNumber =
    deliveryStreet.streetNumber;

  const billingAddressStreetName =
    billingStreet.streetName;

  const billingAddressStreetNumber =
    billingStreet.streetNumber;

  const paymentInterface =
    getPaymentInterfaceFromContext() ||
    "mock";

  /**
   * --------------------------------------------------
   * Create commercetools Payment
   * --------------------------------------------------
   */
  const ctPayment =
    await this.ctPaymentService.createPayment({
      amountPlanned: paymentAmount,

      paymentMethodInfo: {
        paymentInterface,
      },

      ...(ctCart.customerId && {
        customer: {
          typeId: "customer",
          id: ctCart.customerId,
        },
      }),

      ...(!ctCart.customerId &&
        ctCart.anonymousId && {
          anonymousId:
            ctCart.anonymousId,
        }),
    });

  await this.ctCartService.addPayment({
    resource: {
      id: ctCart.id,
      version: ctCart.version,
    },

    paymentId: ctPayment.id,
  });

  /**
   * --------------------------------------------------
   * Create PSP reference
   * --------------------------------------------------
   */
  const pspReference =
    randomUUID().toString();

  /**
   * --------------------------------------------------
   * Create pending transaction
   * --------------------------------------------------
   */
  const transactionComments =
    `Novalnet Transaction ID: N/A\n` +
    `Payment Type: N/A\n` +
    `Status: N/A`;

  await this.ctPaymentService.updatePayment({
    id: ctPayment.id,

    pspReference,

    paymentMethod:
      request.data.paymentMethod.type,

    transaction: {
      type: "Authorization",

      amount:
        ctPayment.amountPlanned,

      interactionId:
        pspReference,

      state: "Pending",

      custom: {
        type: {
          typeId: "type",
          key:
            "novalnet-custom-field",
        },

        fields: {
          transactionComments,
        },
      },
    } as unknown as any,
  } as any);

  /**
   * --------------------------------------------------
   * Customer name
   * --------------------------------------------------
   */
  const orderNumber =
    getFutureOrderNumberFromContext() ??
    "";

  const ctPaymentId =
    ctPayment.id;

  let firstName = "";
  let lastName = "";

  if (ctCart.customerId) {
    const customerRes =
      await projectApiRoot
        .customers()
        .withId({
          ID: ctCart.customerId,
        })
        .get()
        .execute();

    const ctCustomer =
      customerRes.body;

    firstName =
      ctCustomer.firstName ?? "";

    lastName =
      ctCustomer.lastName ?? "";
  } else {
    firstName =
      ctCart.shippingAddress
        ?.firstName ?? "";

    lastName =
      ctCart.shippingAddress
        ?.lastName ?? "";
  }

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

  const hookUrl = new URL(
     "/novalnletWebhook",
     processorURL,
  );
    
  const transaction: Record<
    string,
    any
  > = {
    test_mode:
      Number(testMode) === 0
        ? "0"
        : "1",

    payment_type:
      type.toUpperCase(),

    amount:
      String(
        parsedCart?.taxedPrice
          ?.totalGross
          ?.centAmount,
      ),

    currency:
      String(
        parsedCart?.taxedPrice
          ?.totalGross
          ?.currencyCode,
      ),

    return_url:
      returnUrl,

    error_return_url:
      errorReturnUrl,

    hook_url:
      hookUrl.toString(),

    order_no:
      orderNumber,
  };

  /**
   * --------------------------------------------------
   * CREDIT CARD
   * --------------------------------------------------
   *
   * For credit card redirect payment,
   * pan_hash and unique_id are mandatory.
   *
   * This is the same payment_data used
   * by createDirectPayment().
   */
  if (
    type.toUpperCase() ===
    "CREDITCARD"
  ) {
    const panHash =
      String(
        request.data
          .paymentMethod
          ?.panHash ?? "",
      );

    const uniqueId =
      String(
        request.data
          .paymentMethod
          ?.uniqueId ?? "",
      );

    if (!panHash || !uniqueId) {
      throw new Error(
        "Credit card pan_hash or unique_id is missing",
      );
    }

    /**
     * Enable 3D Secure when configured.
     */
    if (enforce3d === "1") {
      transaction.enforce_3d = 1;
    }

    transaction.payment_data = {
      pan_hash:
        panHash,

      unique_id:
        uniqueId,
    };
  }

  /**
   * --------------------------------------------------
   * Novalnet Payload
   * --------------------------------------------------
   */
  const novalnetPayload = {
    merchant: {
      signature:
        String(
          getConfig()
            ?.novalnetPrivateKey ??
            "",
        ),

      tariff:
        String(
          getConfig()
            ?.novalnetTariff ??
            "",
        ),
    },

    customer: {
      billing: {
        city:
          String(
            billingAddress?.city,
          ),

        country_code:
          String(
            billingAddress?.country,
          ),

        house_no:
          String(
            billingAddressStreetNumber,
          ),

        street:
          String(
            billingAddressStreetName,
          ),

        zip:
          String(
            billingAddress?.postalCode,
          ),
      },

      shipping: {
        city:
          String(
            deliveryAddress?.city,
          ),

        country_code:
          String(
            deliveryAddress?.country,
          ),

        house_no:
          String(
            deliveryAddressStreetNumber,
          ),

        street:
          String(
            deliveryAddressStreetName,
          ),

        zip:
          String(
            deliveryAddress?.postalCode,
          ),
      },

      first_name:
        firstName,

      last_name:
        lastName,

      email:
        parsedCart.customerEmail,
    },

    transaction,

    custom: {
      input1:
        "ctpayment-id",

      inputval1:
        String(
          ctPaymentId ??
            "ctpayment-id not available",
        ),

      input2:
        "pspReference",

      inputval2:
        String(
          pspReference ?? "0",
        ),

      input3:
        "lang",

      inputval3:
        String(
          lang ??
            "lang-no-longer-available",
        ),
    },
  };

  /**
   * --------------------------------------------------
   * Call Novalnet
   * --------------------------------------------------
   */
  let parsedResponse: any = {};

  try {
    parsedResponse = await this.callNovalnet(
      "https://payport.novalnet.de/v2/payment",
      novalnetPayload,
    );
  } catch (err) {
    log.error(
      "Failed to process redirect payment with Novalnet:",
      err,
    );

    throw new Error(
      "Payment initialization failed",
    );
  }

  /**
   * --------------------------------------------------
   * Validate Novalnet response
   * --------------------------------------------------
   */
  if (
    parsedResponse?.result
      ?.status !== "SUCCESS"
  ) {
    log.error(
      "Novalnet API error - Status not SUCCESS:",
      {
        status:
          parsedResponse
            ?.result
            ?.status,

        statusText:
          parsedResponse
            ?.result
            ?.status_text,

        fullResponse:
          parsedResponse,
      },
    );

    throw new Error(
      parsedResponse
        ?.result
        ?.status_text ||
        "Payment initialization failed",
    );
  }

  /**
   * --------------------------------------------------
   * Get redirect URL
   * --------------------------------------------------
   */
  const redirectUrl =
    parsedResponse
      ?.result
      ?.redirect_url;

  const txnSecret =
    parsedResponse
      ?.transaction
      ?.txn_secret;

  if (!txnSecret) {
    log.error(
      "No txn_secret in Novalnet response:",
      {
        transaction:
          parsedResponse
            ?.transaction,

        fullResponse:
          parsedResponse,
      },
    );

    throw new Error(
      "Payment initialization failed - missing transaction secret",
    );
  }

  /**
   * --------------------------------------------------
   * Return redirect URL to frontend
   * --------------------------------------------------
   */
  return {
    paymentReference:
      ctPaymentId,

    txnSecret:
      redirectUrl,
  };
}

  public async localcomments(hook: any, params: TransactionCommentParams) {
    const supportedLocales: SupportedLocale[] = ["en", "de"];
    const normalized: Record<string, string> = {
      eventTID: params.eventTID ?? "-",
      parentTID: params.parentTID ?? "-",
      amount:
        params.amount !== null && params.amount !== undefined
          ? String(params.amount)
          : "-",
      currency: params.currency ?? "-",
      date: params.date ?? "-",
      time: params.time ?? "-",
      transactionID: params.transactionID ?? "-",
      dueDate: params.dueDate ?? "-",
    };

    const localizedTransactionComments = supportedLocales.reduce(
      (acc, locale) => {
        acc[locale] = t(locale, hook, normalized);
        return acc;
      },
      {} as Record<SupportedLocale, string>,
    );

    return localizedTransactionComments;
  }

  public createPaymentReturnUrls({
  processorURL,
  sessionId,
  paymentReference,
  orderNumber,
  ctPaymentID,
  pspReference,
  lang,
  path,
}: {
  processorURL: string;
  sessionId: string;
  paymentReference: string;
  orderNumber: string;
  ctPaymentID: string;
  pspReference: string;
  lang: string;
  path: string;
}): {
  returnUrl: string;
  errorReturnUrl: string;
} {
  const successUrl = new URL(
    "/success",
    processorURL,
  );

  successUrl.searchParams.set(
    "paymentReference",
    paymentReference,
  );

  successUrl.searchParams.set(
    "ctsid",
    sessionId,
  );

  successUrl.searchParams.set(
    "orderNumber",
    orderNumber,
  );

  successUrl.searchParams.set(
    "ctPaymentID",
    ctPaymentID,
  );

  successUrl.searchParams.set(
    "pspReference",
    pspReference,
  );

  successUrl.searchParams.set(
    "lang",
    lang,
  );

  successUrl.searchParams.set(
    "path",
    path,
  );

  const failureUrl = new URL(
    "/failure",
    processorURL,
  );

  failureUrl.searchParams.set(
    "paymentReference",
    paymentReference,
  );

  failureUrl.searchParams.set(
    "ctsid",
    sessionId,
  );

  failureUrl.searchParams.set(
    "orderNumber",
    orderNumber,
  );

  failureUrl.searchParams.set(
    "ctPaymentID",
    ctPaymentID,
  );

  failureUrl.searchParams.set(
    "pspReference",
    pspReference,
  );

  failureUrl.searchParams.set(
    "lang",
    lang,
  );

  failureUrl.searchParams.set(
    "path",
    path,
  );

  return {
    returnUrl: successUrl.toString(),
    errorReturnUrl: failureUrl.toString()
  };
}

private async createPendingPaymentTransaction({
  paymentId,
  amount,
  pspReference,
  paymentMethod,
}: {
  paymentId: string;
  amount: any;
  pspReference: string;
  paymentMethod: string;
}) {
  await this.ctPaymentService.updatePayment({
    id: paymentId,
    pspReference,
    paymentMethod,
    transaction: {
      type: "Authorization",
      amount,
      interactionId: pspReference,
      state: "Pending",
    },
  } as any);
}

  private async addSettlementTransactionIfRequired({
    paymentId,
    pspReference,
    amount,
    currency,
    transactionType,
    status,
  }: {
    paymentId: string;
    pspReference: string;
    amount?: string | number;
    currency?: string;
    transactionType: "Authorization" | "Charge" | "CancelAuthorization";
    status: string;
  }) {
    if (transactionType === "Authorization") return;

    const paymentRes = await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .get()
      .execute();

    const payment = paymentRes.body;
    const interactionId = `${pspReference}-${transactionType}`;
    const alreadyAdded = payment.transactions?.some(
      (transaction) => transaction.interactionId === interactionId,
    );

    if (alreadyAdded) {
      log.info("Settlement transaction already exists", {
        paymentId,
        transactionType,
        interactionId,
      });
      return;
    }

    const transactionAmount = amount != null
      ? {
          centAmount: Number(amount),
          currencyCode: String(currency ?? payment.amountPlanned.currencyCode),
        }
      : payment.amountPlanned;

    await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .post({
        body: {
          version: payment.version,
          actions: [
            {
              action: "addTransaction",
              transaction: {
                type: transactionType,
                amount: transactionAmount,
                interactionId,
                state: "Success",
              },
            },
          ],
        },
      })
      .execute();

    log.info("Settlement transaction added", {
      paymentId,
      pspReference,
      transactionType,
      status,
    });
  }

  private buildTransactionComments(
    webhook: Record<string, any>,
  ): string {
  
    const tid = String(webhook.event?.tid ?? "");
  
    const paymentType =
      webhook.transaction?.payment_type ?? "";
  
    const isTestMode =
      webhook.transaction?.test_mode == 1;
  
    const lang: SupportedLocale =
      webhook.custom?.lang === "de"
        ? "de"
        : "en";
  
    const supportedLocales: SupportedLocale[] = [
      "en",
      "de",
    ];
  
    const comments =
      supportedLocales.reduce(
        (acc, locale) => {
  
          acc[locale] = [
            t(locale, "payment.transactionId", { tid }),
            t(locale, "payment.paymentType", {
              type: paymentType,
            }),
            isTestMode
              ? t(locale, "payment.testMode")
              : "",
          ]
            .filter(Boolean)
            .join("\n");
  
          return acc;
  
        },
        {} as Record<SupportedLocale, string>,
      );
  
    return comments[lang];
  }

   private async getOrderIdFromOrderNumber(
    orderNumber: string,
  ): Promise<string | undefined> {
  
    if (!orderNumber) {
  
      log.warn("[ORDER] Empty order number");
  
      return;
    }
  
    const result =
      await projectApiRoot
        .orders()
        .get({
          queryArgs: {
            where: `orderNumber="${orderNumber}"`,
            limit: 1,
          },
        })
        .execute();
  
    const orderId =
      result.body.results[0]?.id;
  
    log.info("[ORDER] Lookup", {
      orderNumber,
      found: Boolean(orderId),
      orderId,
    });
  
    return orderId;
  }

    private async updateOrderComments(
    orderId: string,
  ): Promise<void> {
  
    log.info("[ORDER] Comment synchronization started", {
      orderId,
    });
  
    const order = (
      await projectApiRoot
        .orders()
        .withId({ ID: orderId })
        .get()
        .execute()
    ).body;
  
    const paymentId =
      order.paymentInfo?.payments?.[0]?.id;
  
    if (!paymentId) {
  
      log.warn("[ORDER] No payment linked", {
        orderId,
      });
  
      return;
    }
  
    const payment = (
      await projectApiRoot
        .payments()
        .withId({ ID: paymentId })
        .get()
        .execute()
    ).body;
  
    const transaction = [...(payment.transactions ?? [])]
      .reverse()
      .find(tx => tx.interactionId);
  
    if (!transaction) {
  
      log.warn("[ORDER] No transaction found", {
        orderId,
        paymentId,
      });
  
      return;
    }
  
    const pspReference =
      transaction.interactionId;
  
    const customObject =
      await customObjectService.get(
        "nn-private-data",
        `${paymentId}-${pspReference}`,
      );
  
    const comments =
      customObject?.value?.comments;
  
    if (!comments) {
  
      log.info("[ORDER] No comments found in CustomObject", {
        paymentId,
        pspReference,
      });
  
      return;
    }
  
    const currentComments =
      order.custom?.fields?.transactionComments;
  
    if (currentComments === comments) {
  
      log.info("[ORDER] Comments already synchronized", {
        orderId,
      });
  
      return;
    }
  
    const updated =
      await projectApiRoot
        .orders()
        .withId({ ID: orderId })
        .post({
          body: {
            version: order.version,
            actions: [
              {
                action: "setCustomField",
                name: "transactionComments",
                value: comments,
              },
            ],
          },
        })
        .execute();
  
    log.info("[ORDER] Comments updated", {
      orderId,
      version: updated.body.version,
    });
  }

  public splitStreetByComma(street?: string): {
    streetName: string;
    streetNumber: string;
  } {
    if (!street) {
      return { streetName: "", streetNumber: "" };
    }

    const parts = street.split(",");

    if (parts.length < 2) {
      return { streetName: street.trim(), streetNumber: "" };
    }

    return {
      streetName: parts[0].trim(),
      streetNumber: parts.slice(1).join(",").trim(),
    };
  }
}
