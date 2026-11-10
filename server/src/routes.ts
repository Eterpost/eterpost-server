import express, { Express, Request, Response } from 'express';
import path from 'node:path';
import { MailingRepository } from './MailingRepository';
import { MailingExecutor } from './MailingExecutor';
import { getMailings } from './controllers/getMailings';
import { getMailing } from './controllers/getMailing';
import { addMailing } from './controllers/addMailing';
import { updateMailing } from './controllers/updateMailing';
import { Logger } from './Logger';
import { MailingStateManager } from './MailingStateManager';
import { getReceivers } from './controllers/getReceivers';
import { deleteMailing } from './controllers/deleteMailing';
import { sendTestEmail } from './controllers/sendTestEmail';
import { previewEmail } from './controllers/previewEmail';
import { previewDraft } from './controllers/previewDraft';
import { getSpaces } from './controllers/getSpaces';
import { restoreExcluded } from './controllers/restoreExcluded';
import { trackClick, trackOpen } from './controllers/tracking';
import { getResults } from './controllers/getResults';
import { AddressStatsRepository } from './AddressStatsRepository';
import { getFailedReceivers } from './controllers/getFailedReceivers';
import { FailureCounter } from './FailureCounter';
import { ReceiverListFilter } from './ReceiverListFilter';
import { createRetryMailing } from './controllers/createRetryMailing';
import { requestSubscription, SubscribeTemplateContext } from './controllers/requestSubscription';
import { SubscriptionRequestRepository } from './SubscriptionRequestRepository';
import { MailSender } from './MailSender';
import { Template } from './templates/Template';
import { subscribe } from './controllers/subscribe';
import { unsubscribe } from './controllers/unsubscribe';
import { deleteReceiver } from './controllers/deleteReceiver';
import { unsubscribeFromAll } from './controllers/unsubscribeFromAll';
import { getSorterStatus } from './controllers/getSorterStatus';
import { RedisSorterStatusRepository } from './RedisSorterStatusRepository';
import { openApiDocument, swaggerUiHtml, swaggerUiInit } from './openapi';
import { ApiKeyRepository } from './ApiKeyRepository';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { SpaceRepository } from './SpaceRepository';
import { loadMailing } from './middleware/loadMailing';


export function setupRoutes (
  config: any, app: Express, repository: MailingRepository, stateManager: MailingStateManager,
  logger: Logger, executor: MailingExecutor, failureCounter: FailureCounter,
  subscriptionRepository: SubscriptionRequestRepository, sender: MailSender,
  subscribeTemplate: Template<SubscribeTemplateContext>, receiverListFilter: ReceiverListFilter,
  sorterStatusRepository: RedisSorterStatusRepository, apiKeyRepository: ApiKeyRepository,
  addressStatsRepository: AddressStatsRepository, spaceRepository: SpaceRepository,
  admins: string[]
) {
  app.use(apiKeyAuth(
    apiKeyRepository, logger, config.server.auth || {}, isApiDocsRequest, spaceRepository, admins
  ));
  // Каждый маршрут с номером рассылки получает её через loadMailing: он
  // проверяет пространство рассылки
  const mailing = loadMailing(repository);
  const mailingById = loadMailing(repository, 'mailingId');
  app.get('/spaces', getSpaces(spaceRepository));
  app.get('/mailings', getMailings(repository));
  app.get('/mailings/:id', mailing, getMailing(repository, config));
  app.post('/mailings', addMailing(config, repository, logger, receiverListFilter));
  app.post('/mailings/unsubscribe', unsubscribeFromAll(repository, logger));
  app.post('/mailings/create-retry', createRetryMailing(
    config, repository, logger, failureCounter
  ));
  app.put('/mailings/:id', mailing, updateMailing(
    repository, stateManager, logger, receiverListFilter
  ));
  app.get('/mailings/:id/receivers', mailing, getReceivers(repository));
  app.get('/mailings/:id/failed-receivers', mailing, getFailedReceivers(failureCounter));
  app.get('/mailings/:id/results', mailing, getResults(repository, failureCounter));
  app.post('/mailings/:id/send-test-email', mailing, sendTestEmail(executor, logger));
  app.post('/mailings/:id/preview', mailing, previewEmail(executor));
  app.post('/preview', previewDraft(config, executor));
  app.post('/mailings/:id/restore-excluded', mailing, restoreExcluded(
    repository, addressStatsRepository, logger
  ));
  app.delete('/mailings/:id', mailing, deleteMailing(repository, logger));
  app.post('/mailings/:mailingId/requestSubscription', mailingById, requestSubscription(
    subscriptionRepository, logger, sender, subscribeTemplate, config.server.subscription
  ));
  app.post('/mailings/:mailingId/subscribe', mailingById, subscribe(
    subscriptionRepository, logger
  ));
  app.post('/mailings/:mailingId/unsubscribe', mailingById, unsubscribe(
    subscriptionRepository, repository, logger
  ));
  app.delete('/mailings/:mailingId/receivers/:receiverId', mailingById, deleteReceiver(logger));
  app.get('/sorter/status', getSorterStatus(sorterStatusRepository, config));
  app.post('/tracking/open', trackOpen(repository));
  app.post('/tracking/click', trackClick(repository));

  setupApiDocs(app);
}

// Описание API открыто без ключа: ключ вводится в Swagger UI кнопкой Authorize
function isApiDocsRequest (req: Request): boolean {
  return req.path === '/openapi.json' || req.path === '/docs' || req.path.startsWith('/docs/');
}

/**
 * Описание API: /openapi.json и Swagger UI на /docs/
 */
export function setupApiDocs (app: Express) {
  app.get('/openapi.json', (req: Request, res: Response) => {
    res.json(openApiDocument);
  });
  // Express сопоставляет /docs и /docs/ одному маршруту. Без слэша — относительный
  // редирект: за nginx (/api/docs) он приведёт на /api/docs/
  app.get('/docs', (req: Request, res: Response) => {
    if (req.path.endsWith('/')) {
      res.type('html').send(swaggerUiHtml);
    } else {
      res.redirect(301, 'docs/');
    }
  });
  app.get('/docs/init.js', (req: Request, res: Response) => {
    res.type('js').send(swaggerUiInit);
  });
  const swaggerUiDir = path.dirname(require.resolve('swagger-ui-dist/swagger-ui-bundle.js'));
  app.use('/docs', express.static(swaggerUiDir, { index: false }));
}
