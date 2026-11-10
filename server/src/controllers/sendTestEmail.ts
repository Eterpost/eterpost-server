import { Request, Response } from 'express';
import { success } from '../utils/response';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { Logger } from '../Logger';
import { MailingExecutor } from '../MailingExecutor';
import { getLoadedMailing } from '../middleware/loadMailing';


export function sendTestEmail (executor: MailingExecutor, logger: Logger) {
  const handler = async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);

    await executor.sendTestEmail(mailing, req.body.email);

    res.json(success());
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

export const requestBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    email: {
      format: 'email',
      type: 'string'
    }
  },
  required: [
    'email'
  ]
};
