import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:santha_api/santha_api.dart';
import 'package:test/test.dart';

/// Records requests and answers from a route table.
class _Backend implements HttpClientAdapter {
  _Backend(this.routes);
  final Map<String, (int, Object?)> routes;
  final List<(String, Object?)> calls = [];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? _) async {
    final key = '${o.method} ${o.path}';
    calls.add((key, o.data));
    final (status, body) = routes[key] ?? (404, {'error': {'code': 'NOT_FOUND', 'message': 'nope'}});
    return ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

MerchantApi _api(_Backend backend) => MerchantApi(SanthaApiClient(
      baseUrl: 'http://api.test',
      deviceId: 'dev-1',
      tokens: MemoryTokenStore(),
      dio: Dio()..httpClientAdapter = backend,
    ));

Map<String, dynamic> _fixture(String name) => jsonDecode(File('test/fixtures/$name').readAsStringSync()) as Map<String, dynamic>;

void main() {
  test('parses a real GET /v1/merchants/me response (recorded from the fake backend)', () {
    final v = MerchantView.fromJson(_fixture('merchant_view_live_kitchen.json'));
    expect(v.merchant.name, "Saraswathi's Kitchen");
    expect(v.merchant.type, MerchantType.homeKitchen);
    expect(v.merchant.status, MerchantStatus.live);
    expect(v.merchant.needsFssai, isTrue);
    expect(v.merchant.hours!['mon']!.single.open, '11:00');
    expect(v.microMarket!.slug, 'dargamitta');
    expect(v.check(KycKind.fssai)!.status, KycStatus.verified);
    expect(v.check(KycKind.pan)!.display, startsWith('AB'));
    expect(v.checklist.map((c) => c.key), containsAll([ChecklistKey.fssai, ChecklistKey.hygiene]));
    expect(v.canSubmit, isFalse); // live stores cannot resubmit
  });

  test('mine() is null when the owner has no store yet', () async {
    expect(await _api(_Backend({})).mine(), isNull);
  });

  test('create sends only the fields given; KYC calls hit the right endpoints', () async {
    final view = _fixture('merchant_view_live_kitchen.json');
    final check = {'kind': 'pan', 'status': 'failed', 'valueMasked': 'AB******0K', 'valuePublic': null, 'nameOnRecord': null, 'provider': 'mock', 'failureReason': 'PAN not found', 'details': null, 'verifiedAt': null, 'updatedAt': '2026-11-01T10:00:00.000Z'};
    final backend = _Backend({
      'POST /v1/merchants': (201, view),
      'PUT /v1/merchants/me/kyc/pan': (200, check),
    });
    final api = _api(backend);
    await api.create(type: MerchantType.retail, name: 'Ramesh Stores');
    expect(backend.calls.last.$2, {'type': 'retail', 'name': 'Ramesh Stores'});
    final c = await api.verifyPan(pan: 'ABCPR0000K', name: 'Ramesh');
    expect(c.status, KycStatus.failed);
    expect(c.failureReason, 'PAN not found');
  });

  test('errors carry the backend code and details', () async {
    final backend = _Backend({
      'POST /v1/merchants/me/submit': (422, {'error': {'code': 'CHECKLIST_INCOMPLETE', 'message': 'Finish all the steps', 'details': {'missing': ['fssai']}}}),
    });
    await expectLater(
      _api(backend).submit(),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'CHECKLIST_INCOMPLETE').having((e) => e.details['missing'], 'missing', ['fssai'])),
    );
  });
}
