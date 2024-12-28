const { parse } = require('url');
const querystring = require('querystring');

const service = ({logger, makeService}) => {
  const svc = makeService({path: '/retell'});

  svc.on('session:new', async(session, _path, req) => {
    const { query } = parse(req.url);
    const queryArgs = querystring.parse(query);

    session.locals = {logger: logger.child({call_sid: session.call_sid})};
    const {from, to, direction, call_sid} = session;
    logger.info({session, queryArgs}, `new incoming call: ${session.call_sid}`);

    let outboundFromRetell = false;
    if (session.direction === 'inbound' && session.sip.headers['X-Authenticated-User']) {
      logger.info(`call ${session.call_sid} is coming from Retell`);
      outboundFromRetell = true;
    }
    session
      .on('/refer', onRefer.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session));

    try {
      let target;
      if (outboundFromRetell) {
        /* call is coming from Retell, so we will forward it to the original dialed number */
        target = [
          {
            type: 'phone',
            number: to
          }
        ];
      }
      else {
        /* https://docs.retellai.com/make-calls/custom-telephony#method-1-elastic-sip-trunking-recommended */

        /**
         * Note: below we are forwarding the incoming call to Retell using the same dialed number.
         * This presumes you have added this number to your Retell account.
         * If you added a different number, you can change the `to` variable.
         */
        target = [
          {
            type: 'phone',
            number: to,
            trunk: 'Retell-jambonz-hosted'
          }
        ];
      }

      session
        .dial({
          callerId: from,
          answerOnBridge: true,
          referHook: '/refer',
          target
        })
        .hangup()
        .send();
    } catch (err) {
      session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
      session.close();
    }
  });
};

const onRefer = (session, evt) => {
  const {logger} = session.locals;
  const {refer_details} = evt;
  logger.info({refer_details}, `session ${session.call_sid} received refer`);

  session
    .sip_refer({
      referTo: refer_details.refer_to_user,
      referredBy: evt.to
    })
    .reply();
};

const onClose = (session, code, reason) => {
  const {logger} = session.locals;
  logger.info({session, code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.info({err}, `session ${session.call_sid} received error`);
};

module.exports = service;
