import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Product analytics (PostHog) behind an interface. Event names and properties are listed in
/// docs/events.md (client section). Until the PostHog SDK is attached (ADR-006), [DebugAnalytics]
/// logs events in debug builds and records them for tests.
abstract interface class Analytics {
  void track(String event, [Map<String, Object?> properties = const {}]);
}

class DebugAnalytics implements Analytics {
  final List<(String, Map<String, Object?>)> events = [];

  @override
  void track(String event, [Map<String, Object?> properties = const {}]) {
    events.add((event, properties));
    if (events.length > 500) events.removeAt(0);
    if (kDebugMode) debugPrint('[analytics] $event $properties');
  }
}

final analyticsProvider = Provider<Analytics>((ref) => DebugAnalytics());
