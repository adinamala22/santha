import 'dart:convert';
import 'dart:io';

import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

Map<String, dynamic> fixture(String name) => jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>;
List<Map<String, dynamic>> items(String name) => (fixture(name)['items'] as List).cast<Map<String, dynamic>>();

/// Contract: the M7 models parse real responses captured from `pnpm dev:fake`.
void main() {
  test('a small missing-item claim is auto-resolved to the wallet', () {
    final i = Issue.fromJson(fixture('issue_auto_resolved'));
    expect(i.type, IssueType.missingItem);
    expect(i.status, IssueStatus.autoResolved);
    expect(i.refundPaise, i.claimedPaise);
    expect(i.refundDestination, 'wallet');
  });

  test('merchant payout: totals add up, GST split, statement available', () {
    final p = Payout.fromJson(items('merchant_payouts').first);
    final lineNet = p.lines.fold<int>(0, (s, l) => s + (l['netPaise'] as int));
    expect(p.netPaise, lineNet + p.total('adjustmentsPaise'));
    expect(p.total('cgstPaise') + p.total('sgstPaise'), p.lines.fold<int>(0, (s, l) => s + (l['commissionGstPaise'] as int)));
    expect(p.hasStatement, isTrue);
    expect(p.total('refundsChargedPaise'), greaterThan(0));
    expect(['transferred', 'on_hold'], contains(p.status));
  });

  test('store refunds are disputable, and a dispute opens', () {
    final r = StoreRefund.fromJson(items('store_refunds').first);
    expect(r.disputable, isTrue);
    expect(r.orderCode, isNotEmpty);
    final d = Dispute.fromJson(fixture('dispute_open'));
    expect(d.status, 'open');
    expect(d.refundId, r.id);
  });

  test('rider payout: earned minus cash held', () {
    final p = Payout.fromJson(items('rider_payouts').first);
    expect(p.netPaise, p.total('earnedPaise') - p.total('cashHeldPaise') + p.total('adjustmentsPaise'));
    expect(p.lines, isNotEmpty);
  });
}
