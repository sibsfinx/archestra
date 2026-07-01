import { emailInterceptor } from "../email-interceptor";
import type { TransactionalEmail } from "../types";

export async function sendViaCaptureProvider(message: TransactionalEmail) {
  emailInterceptor.capture(message);
}
