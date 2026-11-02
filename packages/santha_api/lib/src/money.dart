// Money-close models (M7): issues, ratings, payouts, store refunds and disputes.
import 'models.dart';

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String);

enum IssueType {
  missingItem('missing_item'),
  wrongItem('wrong_item'),
  damaged('damaged'),
  quality('quality'),
  late('late'),
  notDelivered('not_delivered'),
  returnRequest('return_request');

  const IssueType(this.wire);
  final String wire;
  static IssueType parse(String s) => values.firstWhere((v) => v.wire == s);
  /// Item problems ask which lines.
  bool get needsItems => const [missingItem, wrongItem, damaged, quality, returnRequest].contains(this);
}

enum IssueStatus {
  autoResolved('auto_resolved'),
  pendingReview('pending_review'),
  approved('approved'),
  rejected('rejected'),
  returnPickup('return_pickup');

  const IssueStatus(this.wire);
  final String wire;
  static IssueStatus parse(String s) => values.firstWhere((v) => v.wire == s);
}

class Issue {
  const Issue({required this.id, required this.orderId, required this.type, required this.status, required this.claimedPaise, required this.refundPaise, required this.createdAt, this.refundDestination});
  factory Issue.fromJson(Json j) => Issue(
        id: j['id'] as String,
        orderId: j['orderId'] as String,
        type: IssueType.parse(j['type'] as String),
        status: IssueStatus.parse(j['status'] as String),
        claimedPaise: j['claimedPaise'] as int,
        refundPaise: j['refundPaise'] as int,
        refundDestination: j['refundDestination'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
  final String id;
  final String orderId;
  final IssueType type;
  final IssueStatus status;
  final int claimedPaise;
  final int refundPaise;
  /// wallet | source
  final String? refundDestination;
  final DateTime createdAt;
}

class Payout {
  const Payout({
    required this.id,
    required this.periodStart,
    required this.periodEnd,
    required this.grossPaise,
    required this.netPaise,
    required this.status,
    required this.totals,
    required this.lines,
    required this.hasStatement,
    this.transferRef,
  });
  factory Payout.fromJson(Json j) => Payout(
        id: j['id'] as String,
        periodStart: DateTime.parse(j['periodStart'] as String),
        periodEnd: DateTime.parse(j['periodEnd'] as String),
        grossPaise: j['grossPaise'] as int,
        netPaise: j['netPaise'] as int,
        status: j['status'] as String,
        totals: {for (final e in (j['totals'] as Json).entries) e.key: (e.value as num).toInt()},
        lines: (j['lines'] as List).cast<Json>(),
        hasStatement: j['hasStatement'] as bool,
        transferRef: j['transferRef'] as String?,
      );
  final String id;
  final DateTime periodStart;
  final DateTime periodEnd;
  final int grossPaise;
  final int netPaise;
  /// pending | transferred | failed | on_hold
  final String status;
  final Map<String, int> totals;
  final List<Json> lines;
  final bool hasStatement;
  final String? transferRef;
  int total(String key) => totals[key] ?? 0;
}

class StoreRefund {
  const StoreRefund({required this.id, required this.orderCode, required this.amountPaise, required this.reason, required this.disputable, this.processedAt});
  factory StoreRefund.fromJson(Json j) => StoreRefund(
        id: j['id'] as String,
        orderCode: j['orderCode'] as String,
        amountPaise: j['amountPaise'] as int,
        reason: j['reason'] as String,
        disputable: j['disputable'] as bool,
        processedAt: _date(j['processedAt']),
      );
  final String id;
  final String orderCode;
  final int amountPaise;
  final String reason;
  final bool disputable;
  final DateTime? processedAt;
}

class Dispute {
  const Dispute({required this.id, required this.status, required this.reason, required this.adjustmentPaise, this.refundId, this.resolutionNote});
  factory Dispute.fromJson(Json j) => Dispute(
        id: j['id'] as String,
        status: j['status'] as String,
        reason: j['reason'] as String,
        adjustmentPaise: j['adjustmentPaise'] as int,
        refundId: j['refundId'] as String?,
        resolutionNote: j['resolutionNote'] as String?,
      );
  final String id;
  /// open | accepted | rejected
  final String status;
  final String reason;
  final int adjustmentPaise;
  final String? refundId;
  final String? resolutionNote;
}
