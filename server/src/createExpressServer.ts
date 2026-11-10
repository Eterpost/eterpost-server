import express, { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import { bodyParser } from './middleware/bodyParser';


export function createExpressServer (config: any): Express {
  const app = express();
  // За nginx на той же машине req.ip берётся из X-Forwarded-For
  app.set('trust proxy', 'loopback');
  const parserMiddleware = bodyParser();
  const whitelist = config.corsWhitelist;
  const corsOptions = {
    credentials: true,
    origin: whitelist
  };
  app.use(cors(corsOptions));
  // Тело загрузки вложения — сам файл: его читает маршрут (rawAttachmentBody)
  app.post('/{*path}', parserMiddleware.map(exceptAttachmentUpload));
  app.put('/{*path}', parserMiddleware);
  return app;
}

export function isAttachmentUpload (path: string): boolean {
  return /^\/mailings\/\d+\/attachments\/?$/.test(path);
}

function exceptAttachmentUpload (handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isAttachmentUpload(req.path)) {
      next();
    } else {
      handler(req, res, next);
    }
  };
}
