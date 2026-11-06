import 'package:santha_core/santha_core.dart';

import 'l10n/gen/app_localizations.dart';

/// Topics this app offers when starting a support chat (same list as the backend's SUPPORT_TOPICS.rider).
const supportTopics = ['delivery', 'payout', 'app', 'account', 'other'];

/// Support chat copy in the app's language (ADR-028).
SupportStrings supportStrings(AppLocalizations l) => SupportStrings(
      title: l.supportTitle,
      intro: l.supportIntro,
      newChat: l.supportNewChat,
      empty: l.supportEmpty,
      topicTitle: l.supportTopicTitle,
      messageHint: l.supportMessageHint,
      send: l.supportSend,
      start: l.supportStart,
      support: l.supportSender,
      waitingSupport: l.supportWaitingSupport,
      waitingCustomer: l.supportWaitingCustomer,
      resolved: l.supportResolved,
      resolvedNote: l.supportResolvedNote,
      orderLabel: l.supportOrderLabel,
      topicLabel: (t) => switch (t) {
        'order_late' => l.topic_order_late,
        'missing_item' => l.topic_missing_item,
        'wrong_item' => l.topic_wrong_item,
        'payment' => l.topic_payment,
        'refund' => l.topic_refund,
        'account' => l.topic_account,
        'orders' => l.topic_orders,
        'payout' => l.topic_payout,
        'catalogue' => l.topic_catalogue,
        'delivery' => l.topic_delivery,
        'app' => l.topic_app,
        _ => l.topic_other,
      },
      tooManyOpen: l.supportTooManyOpen,
      slowDown: l.supportSlowDown,
      closed: l.supportClosed,
      errorNetwork: l.errorNetwork,
      errorGeneric: l.errorGeneric,
      loading: l.supportLoading,
      retry: l.retry,
    );
