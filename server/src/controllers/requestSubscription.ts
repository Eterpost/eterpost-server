import { Request, Response } from 'express';
import { error, success } from '../utils/response.js';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware.js';
import { catchPromise } from '../utils/catchPromise.js';
import { Logger } from '../Logger.js';
import { SubscriptionRequestRepository } from '../SubscriptionRequestRepository.js';
import { MailSender } from '../MailSender.js';
import { Template } from '../templates/Template.js';
import { Mailing } from '../Mailing.js';
import { SubscriptionRequest } from '../SubscriptionRequest.js';
import { Email } from '../Email.js';
import { Receiver } from '../Receiver.js';
import { generateUniqueCode } from '../utils/codes.js';
import { getLoadedMailing } from '../middleware/loadMailing.js';


export interface SubscribeTemplateContext {
  alreadySubscribed: boolean;
  /**
   * Ссылка подтверждения на страницу подписки (subscription-facade)
   */
  confirmUrl?: string;
  mailing: Mailing;
  name?: string;
  subscriptionRequest: SubscriptionRequest;
  /**
   * Адрес страниц подписки, server.subscription.url
   */
  subscribeUrl?: string;
}

export interface SubscriptionConfig {
  replyTo?: string;
  subject: string;
  url?: string;
}

export function getConfirmUrl (baseUrl: string, request: SubscriptionRequest): string {
  const query = new URLSearchParams({
    code: request.code,
    email: request.email,
    mailingId: String(request.mailingId)
  });
  return `${baseUrl.replace(/\/+$/, '')}/subscribe?${query}`;
}

export function requestSubscription (
  subscriptionRepository: SubscriptionRequestRepository, logger: Logger,
  sender: MailSender, subscribeTemplate: Template<SubscribeTemplateContext>,
  config: SubscriptionConfig
) {
  const handler = async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);
    const mailingId = mailing.id;
    const schedule = req.body.schedule || String(req.body.periodicDate);

    if (!mailing.openForSubscription) {
      res.status(400).json(
        error('Mailing is closed for subscription.', 'CLOSED_FOR_SUBSCRIPTION')
      );
      return;
    }

    if (!Receiver.validateSchedule(schedule)) {
      res.status(400).json(error('Invalid schedule.', 'INVALID_SCHEDULE'));
      return;
    }

    const alreadySubscribed = await mailing.hasReceiver(req.body.email);

    let code = generateUniqueCode();

    logger.info(
      `Requested subscription: mailing #${mailingId}, ${req.body.email}, date: ${
        req.body.periodicDate
      }`
    );

    let subscriptionRequest = await subscriptionRepository.get({
      email: req.body.email,
      mailingId
    });

    if (subscriptionRequest) {
      // если есть существующий запрос - то используем код из него
      // всё остальное перезапишем с нуля
      code = subscriptionRequest.code;
    }

    subscriptionRequest = await subscriptionRepository.create({
      code,
      email: req.body.email,
      mailingId,
      name: req.body.name,
      periodicDate: req.body.periodicDate,
      extraData: req.body.extraData
    });

    const mailText = subscribeTemplate.render({
      alreadySubscribed,
      confirmUrl: config.url ? getConfirmUrl(config.url, subscriptionRequest) : undefined,
      mailing,
      name: req.body.name,
      subscriptionRequest,
      subscribeUrl: config.url
    });
    const email = new Email({
      html: mailText,
      receivers: [new Receiver(req.body.email, req.body.name)],
      replyTo: config.replyTo,
      subject: config.subject
    });
    try {
      await sender.sendEmail(email);
    } catch (error) {
      logger.warn('Caught send error, rolling back subscription request...');
      await subscriptionRepository.remove(subscriptionRequest);
      throw error;
    }

    res.json(success());
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

export const requestBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    email: {
      type: 'string',
      format: 'email'
    },
    name: {
      type: 'string'
    },
    periodicDate: {},
    extraData: {
      type: 'object'
    },
    schedule: {
      type: 'string'
    }
  },
  required: [
    'email'
  ]
};
