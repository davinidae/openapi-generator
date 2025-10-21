import middy, { MiddlewareObj, Request } from "@middy/core";
import errorLoger from "@middy/error-logger";
import httpErrorHandler from "@middy/http-error-handler";
import httpEventNormalizer from "@middy/http-event-normalizer";
import httpHeaderNormalizer from "@middy/http-header-normalizer";
import httpJsonBodyParser from "@middy/http-json-body-parser";
import httpRouter from "@middy/http-router";
import inputOutputLogger from "@middy/input-output-logger";
import eventNormalizer from "@middy/event-normalizer";
import httpCors from "@middy/http-cors";
import httpResponseSerializer from "@middy/http-response-serializer";
import httpSecurityHeaders from "@middy/http-security-headers";
import {
  APIGatewayProxyEvent,
  Context,
  S3ObjectCreatedNotificationEvent,
} from "aws-lambda";
import { Route } from "@middy/http-router";
import { RouteModel } from "./openapi.generator.ts";

type LambdaEvent = APIGatewayProxyEvent | S3ObjectCreatedNotificationEvent;

export type RouteType = RouteModel & Route<APIGatewayProxyEvent, ResponseApi>;

export class ResponseApi {
  constructor(
    public readonly statusCode: number,
    public readonly body?: string
  ) {
    //
  }
}

type S3EventHandler = (
  event: S3ObjectCreatedNotificationEvent,
  context: Context,
  options: unknown
) => Promise<ResponseApi>;

export class MiddyHandler {
  handleS3Event: S3EventHandler = async () => {
    return new ResponseApi(400, "Unsupported S3 Event");
  };
  routes: RouteType[] = [];
  handleCronEvent = async () => {
    return new ResponseApi(400, "Unsupported Cron Event");
  };
  constructor(
    readonly options: Partial<{
      handleS3Event: S3EventHandler;
      routes: RouteType[];
      handleCronEvent: () => Promise<ResponseApi>;
    }>
  ) {
    if (options.handleS3Event != null) {
      this.handleS3Event = options.handleS3Event;
    }
    if (options.handleCronEvent != null) {
      this.handleCronEvent = options.handleCronEvent;
    }
    if (options.routes != null) {
      this.routes = options.routes;
    }
  }

  isS3Event(event: unknown): event is S3ObjectCreatedNotificationEvent {
    return (event as S3ObjectCreatedNotificationEvent)?.source === "aws.s3";
  }

  isHttpEvent(event: unknown): event is APIGatewayProxyEvent {
    return (event as APIGatewayProxyEvent)?.httpMethod != null;
  }
  runIfHttp<T = unknown, R = unknown>(
    middleware: MiddlewareObj<T, R>
  ): MiddlewareObj<T, R> {
    return {
      before: async (request: Request<T, R>) => {
        if (this.isHttpEvent(request.event) && middleware.before) {
          await middleware.before(request);
        }
      },
      after: async (request: Request<T, R>) => {
        if (this.isHttpEvent(request.event) && middleware.after) {
          await middleware.after(request);
        }
      },
      onError: async (request: Request<T, R>) => {
        if (this.isHttpEvent(request.event) && middleware.onError) {
          await middleware.onError(request);
        }
      },
    };
  }

  runIfNotHttp<T = unknown, R = unknown>(
    middleware: MiddlewareObj<T, R>
  ): MiddlewareObj<T, R> {
    return {
      before: async (request: Request<T, R>) => {
        if (!this.isHttpEvent(request.event) && middleware.before) {
          await middleware.before(request);
        }
      },
      after: async (request: Request<T, R>) => {
        if (!this.isHttpEvent(request.event) && middleware.after) {
          await middleware.after(request);
        }
      },
      onError: async (request: Request<T, R>) => {
        if (!this.isHttpEvent(request.event) && middleware.onError) {
          await middleware.onError(request);
        }
      },
    };
  }

  baseHandler = async (
    event: LambdaEvent,
    context: Context,
    options: unknown
  ) => {
    console.log("BASE HANDLER", event, context, options);
    if (this.isS3Event(event)) {
      console.log("IS S3");
      return await this.handleS3Event(event, context, options);
    }
    if (this.isHttpEvent(event)) {
      console.log("IS HTTP");
      const router = httpRouter(this.routes);
      return await router(event, context);
    }
    console.log("UNKNOWN");
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Unsupported event type",
      }),
    };
  };

  getMiddyHandler() {
    return middy()
      .use(this.runIfHttp(httpHeaderNormalizer()))
      .use(this.runIfHttp(httpEventNormalizer()))
      .use(this.runIfNotHttp(eventNormalizer()))
      .use(inputOutputLogger())
      .use(this.runIfHttp(httpErrorHandler()))
      .use(errorLoger())
      .use(
        this.runIfHttp(httpJsonBodyParser({ disableContentTypeError: true }))
      )
      .use(this.runIfHttp(httpCors()))
      .use(this.runIfHttp(httpSecurityHeaders()))
      .use(this.runIfHttp(httpResponseSerializer()))
      .handler(this.baseHandler);
  }
}
