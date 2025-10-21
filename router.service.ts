import { envHandler } from "./env.handler";
import { pingHandler } from "./ping.handler";
import {RouteType} from "./middy.handler"

type RouterOptionsType = {
  apiName: string;
};

export class RouterService {
  routes: RouteType[];

  constructor(
    readonly routesIn: RouteType[],
    readonly options: RouterOptionsType
  ) {
    this.routes = [
      {
        method: "GET",
        path: "/ping",
        handler: pingHandler,
        description: "Checks if lambda is alive",
      },
      {
        method: "GET",
        path: "/check-env",
        handler: checkEnvHandler,
        description: "Checks environment variables",
      },
      ...routesIn,
    ];
  }

  getRoutes() {
    return this.routes;
  }

  getRoutesWithStage() {
    const fixedRoutes = this.routes.map((o) => {
      return {
        ...o,
        path: ["", this.options.apiName, "{stage}", o.path.substring(1)].join(
          "/"
        ),
      };
    });
    return fixedRoutes;
  }
}
