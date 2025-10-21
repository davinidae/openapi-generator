import { ResponseApi } from "../models";

export async function pingHandler(): Promise<ResponseApi> {
  console.log("Ping handler called");
  return new ResponseApi(200, JSON.stringify({ message: "pong" }));
}
