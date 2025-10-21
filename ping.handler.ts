import { ResponseApi } from "./middy.handler";

export async function pingHandler(): Promise<ResponseApi> {
  console.log("Ping handler called");
  return new ResponseApi(200, JSON.stringify({ message: "pong" }));
}
