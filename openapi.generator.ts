import type { OpenAPIV3 } from "openapi-types";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";

function getNewDate(): string {
  const date = DateTime.now().toFormat("yyyyLLdd_HHmmss");
  return date;
}

type AwsData = {
  REGION: string;
  ACCOUNT_ID: string;
  LAMBDA_NAME: string;
  STACK_NAME: string;
  ENV_NAME: string;
  PROJECT_NAME: string;
};

type XAmazonApigatewayIntegration = {
  uri: string;
  httpMethod: string;
  payloadFormatVersion: string;
  responses: {
    default: {
      statusCode: string;
    };
  };
  type: string;
};

type PathsExtra = Partial<{
  "x-amazon-apigateway-integration": XAmazonApigatewayIntegration;
}>;

type ApiDefinition = OpenAPIV3.Document<PathsExtra> &
  Partial<{
    "x-amazon-apigateway-policy": {
      Version: string;
      Statement: ({
        Effect: string;
        Principal: string;
        Action: string;
        Resource: string;
      } & Partial<{
        Condition: {
          StringNotEquals?: Record<string, string>;
        };
      }>)[];
    };
  }>;

// Use Middy library
type RouteModel = {
  method: string;
  path: string;
  useCognito?: boolean;
  description?: string;
  parameters?: {
    in: "path" | "query" | "header" | "cookie";
    name: string;
    required: boolean;
    schema: {
      type: OpenAPIV3.NonArraySchemaObjectType;
    };
    description?: string;
  }[];
  requestBody?: OpenAPIV3.RequestBodyObject;
  responses?: { status: number }[];
};

type EventPattern = {
  "detail-type": string[];
  source: string[];
  detail: {
    bucket: {
      name: string[];
    };
    object: {
      key: { prefix: string }[];
    };
  };
};

type AwsEnvConfig = {
  API_NAME: string;
  DEPLOY_API: boolean;
  DEPLOY_DYNAMODB: boolean;
  DEPLOY_EVENTBRIDGE: boolean;
  DEPLOY_SCHEDULER: boolean;
  QUOTA_LIMIT: number;
  QUOTA_PERIOD: string;
  THROTTLE_RATE: number;
  THROTTLE_BURST: number;
  INTERNAL_ONLY: boolean;
  USE_COGNITO: boolean;
  PRIMARY_ATTRIBUTES: string;
  LAMBDA_VARIABLES: object;
  EVENT_PATTERN_JSON: Record<string, never> | EventPattern;
  SCHEDULE_EXPRESSION: string;
};

export class OpenAPIGenerator {
  readonly awsData: AwsData;
  readonly newDate: string;

  internalUrl = "";
  externalUrl = "";
  internalVpc = "";
  cognitoPrdArnId = "";
  cognitoDevArnId = "";

  constructor(
    readonly routes: RouteModel[],
    readonly config: AwsEnvConfig,
    readonly dirPath: string
  ) {
    console.log("OpenAPIGenerator initialized", dirPath);
    this.awsData = this.getAwsData();
    this.newDate = getNewDate();
  }

  execute() {
    console.log("AWS DATA INFO", JSON.stringify(this.awsData));
    if (
      this.awsData.LAMBDA_NAME == null ||
      this.awsData.LAMBDA_NAME.trim() === ""
    ) {
      console.error(
        "Lambda name is not provided. Use LAMBDA_NAME=<name> to specify it."
      );
      process.exit(1);
    }
    if (this.awsData.ENV_NAME == null || this.awsData.ENV_NAME.trim() === "") {
      console.error(
        "Environment name is not provided. Use ENV_NAME=<name> to specify it."
      );
      process.exit(1);
    }
    this.removeOldFiles();
    const newContent = this.generateNewFile();
    return newContent;
  }

  getAwsData(): AwsData {
    const args = process.argv.slice(2);
    const awsData: AwsData = {
      STACK_NAME: "",
      PROJECT_NAME: "",
      REGION: "",
      ACCOUNT_ID: "",
      LAMBDA_NAME: "",
      ENV_NAME: "dev",
    };
    for (const arg of args) {
      const [key, value] = arg.split("=");
      if (Object.keys(awsData).includes(key)) {
        awsData[key as keyof typeof awsData] = value;
      }
    }
    awsData.STACK_NAME = [awsData.LAMBDA_NAME, "stack"].join("-");
    console.log("AWS DATA : ", awsData);
    return awsData;
  }

  getPathSecurity(route: RouteModel) {
    const path = route.path;
    if (path === "/ping" || path === "/env") {
      return [
        {
          api_key: [],
        },
      ];
    }
    const globalCognito = this.config.USE_COGNITO;
    if (globalCognito == null) {
      return [
        {
          api_key: [],
        },
      ];
    }
    let useCognito = false;
    const localCognito = route.useCognito;
    if (localCognito == null) {
      useCognito = globalCognito;
    } else {
      useCognito = localCognito;
    }
    if (!useCognito) {
      return [
        {
          api_key: [],
        },
      ];
    }
    return [this.getCognitoPool()];
  }

  getCognitoPool(): Record<string, string[]> {
    const env = this.awsData.ENV_NAME.toLowerCase();
    switch (env) {
      case "prd": {
        return {
          cognito_pool_prd: ["default/default"],
        };
      }
      case "dev":
      default: {
        return {
          cognito_pool_dev: ["default/default"],
        };
      }
    }
  }

  addPathDefaults(
    methodObject: OpenAPIV3.OperationObject<PathsExtra>
  ): OpenAPIV3.OperationObject<PathsExtra> {
    const result = structuredClone(methodObject);
    result.tags = [];
    result.responses = {
      200: {
        description: "Succesfully processed",
      },
    };
    return result;
  }

  addPathCustoms(
    methodObject: OpenAPIV3.OperationObject<PathsExtra>,
    route: RouteModel
  ): OpenAPIV3.OperationObject<PathsExtra> {
    const result = structuredClone(methodObject);
    result.description = route.description;
    result.parameters = route.parameters;
    result.requestBody = route.requestBody;
    return result;
  }

  addAwsPathParameters(
    methodObject: OpenAPIV3.OperationObject<PathsExtra>,
    uri: string
  ): OpenAPIV3.OperationObject<PathsExtra> {
    const result = structuredClone(methodObject);
    result["x-amazon-apigateway-integration"] = {
      uri,
      httpMethod: "POST",
      payloadFormatVersion: "2.0",
      responses: {
        default: {
          statusCode: "200",
        },
      },
      type: "AWS_PROXY",
    };
    return result;
  }

  getUri(): string {
    const uri = [
      "arn",
      "aws",
      "apigateway",
      this.awsData.REGION,
      "lambda",
      ["path", "2015-03-31", "functions", "arn"].join("/"),
      "aws",
      "lambda",
      this.awsData.REGION,
      this.awsData.ACCOUNT_ID,
      "function",
      [this.awsData.LAMBDA_NAME, "invocations"].join("/"),
    ].join(":");
    console.log("URI : ", uri);
    return uri;
  }

  getPaths(): OpenAPIV3.PathsObject<PathsExtra> {
    const apiRoutes = this.routes;
    const result: OpenAPIV3.PathsObject<PathsExtra> = {};
    const uri = this.getUri();
    for (const route of apiRoutes) {
      const pathValue = route.path;
      if (result[pathValue] == null) {
        result[pathValue] = {};
      }
      const methodValue = route.method.toLowerCase() as OpenAPIV3.HttpMethods;
      const pathObject = result[pathValue];
      if (pathObject[methodValue] == null) {
        const o: OpenAPIV3.OperationObject<PathsExtra> = {
          responses: {},
        };
        if (!this.config.INTERNAL_ONLY) {
          o.security = this.getPathSecurity(route);
        }
        pathObject[methodValue] = o;
      }
      const methodObject = this.addAwsPathParameters(
        this.addPathCustoms(
          this.addPathDefaults(pathObject[methodValue]),
          route
        ),
        uri
      );
      pathObject[methodValue] = methodObject;
    }
    return result;
  }

  getSecuritySchemes():
    | {
        [key: string]: OpenAPIV3.ApiKeySecurityScheme &
          Partial<{
            "x-amazon-apigateway-authtype": string;
            "x-amazon-apigateway-authorizer": {
              type: string;
              providerARNs: string[];
            };
          }>;
      }
    | undefined {
    if (!this.config.INTERNAL_ONLY) {
      return {
        api_key: {
          type: "apiKey",
          name: "x-api-key",
          in: "header",
        },
        cognito_pool_dev: this.getSecurityCognitoPool("dev"),
        cognito_pool_prd: this.getSecurityCognitoPool("prd"),
      };
    }
    return undefined;
  }

  getSecurityCognitoPool(env: string): OpenAPIV3.ApiKeySecurityScheme &
    Partial<{
      "x-amazon-apigateway-authtype": string;
      "x-amazon-apigateway-authorizer": {
        type: string;
        providerARNs: string[];
      };
    }> {
    return {
      type: "apiKey",
      name: "Authorization",
      in: "header",
      "x-amazon-apigateway-authtype": "cognito_user_pools",
      "x-amazon-apigateway-authorizer": {
        type: "cognito_user_pools",
        providerARNs: [this.getCognitoArn(env)],
      },
    };
  }

  getCognitoArn(env: string): string {
    const base = [
      "arn",
      "aws",
      "cognito-idp",
      this.awsData.REGION,
      this.awsData.ACCOUNT_ID,
      "userpool",
    ].join(":");
    switch (env) {
      case "prd": {
        return [
          base,
          [this.awsData.REGION, this.cognitoPrdArnId].join("_"),
        ].join("/");
      }
      case "dev": {
        return [
          base,
          [this.awsData.REGION, this.cognitoDevArnId].join("_"),
        ].join("/");
      }
      default: {
        return "";
      }
    }
  }

  getApiDefinition(): ApiDefinition {
    const apiDefinition: ApiDefinition = {
      openapi: "3.0.3",
      info: {
        title: `${this.awsData.PROJECT_NAME} API`,
        description: `${this.awsData.PROJECT_NAME} API at ${this.awsData.ENV_NAME.toUpperCase()} environment`,
        version: "1.0.0",
      },
      servers: [
        this.config.INTERNAL_ONLY
          ? {
              url: this.internalUrl,
              description: "Internal domain",
            }
          : {
              url: this.externalUrl,
              description: "Public domain",
            },
      ],
      paths: this.getPaths(),
      components: {
        schemas: {},
        parameters: {},
        responses: {},
        securitySchemes: this.getSecuritySchemes(),
      },
    };
    if (this.config.INTERNAL_ONLY) {
      apiDefinition["x-amazon-apigateway-policy"] = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Deny",
            Principal: "*",
            Action: "execute-api:Invoke",
            Resource: `arn:aws:execute-api:${this.awsData.REGION}:${this.awsData.ACCOUNT_ID}:*/*/*/*`,
            Condition: {
              StringNotEquals: {
                "aws:sourceVpc": this.internalVpc,
              },
            },
          },
          {
            Effect: "Allow",
            Principal: "*",
            Action: "execute-api:Invoke",
            Resource: `arn:aws:execute-api:${this.awsData.REGION}:${this.awsData.ACCOUNT_ID}:*/*/*/*`,
          },
        ],
      };
    }

    return apiDefinition;
  }

  removeOldFiles() {
    const pattern = /^openapi-?.*\.json$/;
    const files = fs.readdirSync(this.dirPath);
    for (const file of files) {
      if (pattern.test(file)) {
        const fullPath = path.join(this.dirPath, file);
        try {
          console.log("Deleting file:", fullPath);
          fs.rmSync(fullPath, { force: true });
          console.log(`Deleted: ${file}`);
        } catch (err) {
          console.error(`Error deleting ${file}:`, err);
        }
      }
    }
  }

  generateNewFile() {
    console.log("*** START Generating OpenAPI files ***");
    const filePathWithDate = path.join(
      this.dirPath,
      `openapi-${this.newDate}.json`
    );
    const filePathWithoutDate = path.join(this.dirPath, `openapi.json`);
    console.log("Generation paths : ", filePathWithDate, filePathWithoutDate);
    const apiDefinition = this.getApiDefinition();
    const content = JSON.stringify(apiDefinition, null, 2);
    fs.writeFileSync(filePathWithDate, content);
    fs.writeFileSync(filePathWithoutDate, content);
    console.log("*** END Generating OpenAPI files ***");
    return apiDefinition;
  }
}
