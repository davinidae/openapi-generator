import { ResponseApi } from "./middy.handler";

export async function checkEnvHandler(): Promise<ResponseApi> {
  console.log("Check env handler called");
  return new ResponseApi(200, JSON.stringify(process.env));
}
