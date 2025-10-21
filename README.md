# AWS OpenAPI Generator using Middy and Lambdas

Usage

```typescript
// routes.ts -> MODULE
import { RouterService } from "./router.service";
import { APIGatewayProxyEvent } from "aws-lambda";

export const routes = new RouterService(
  [
    {
      method: "POST",
      path: "/path",
      handler: async function (event: APIGatewayProxyEvent) {
        return new ResponseApi(
          201,
          JSON.stringify({
            message: "Accepted",
          })
        );
      },
      description: "",
    },
  ],
  {
    apiName: API_NAME,
  }
);
```

```typescript
// index.ts -> LAMBDA CODE
import { routes } from "./routes";
import { MiddyHandler } from "./middy.handler";

const service = new MiddyHandler({
  routes: routes.getRoutesWithStage() // OR routes.getRoutes()
});

export const handler = service.getMiddyHandler();
```

```typescript
// openapi.processor.ts -> SCRIPT FOR PIPELINE

import path from "path";
import { fileURLToPath } from "url";
import { routes } from "./routes";
import { OpenAPIGenerator } from "./openapi.generator";

function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.join(path.dirname(__filename), "..");
  const processor = new OpenAPIGenerator(
    routes.getRoutes(),
    { config },
    __dirname
  );
  processor.execute();
}

main();
```
