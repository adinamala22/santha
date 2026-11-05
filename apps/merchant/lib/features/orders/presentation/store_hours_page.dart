import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../onboarding/data/onboarding_controller.dart';
import '../../onboarding/presentation/copy.dart';
import '../../onboarding/presentation/widgets.dart';

/// Store hours for a live store (ADR-021), one row per day: open or closed, opening and closing time.
/// A closing time before the opening time runs past midnight (18:00–01:00). Customers see the store open
/// in these hours; the Open switch opens it outside them until the next close.
/// Extra periods of a day (split shifts set by ops) are kept as they are.
class StoreHoursPage extends ConsumerStatefulWidget {
  const StoreHoursPage({super.key});
  @override
  ConsumerState<StoreHoursPage> createState() => _StoreHoursPageState();
}

class _StoreHoursPageState extends ConsumerState<StoreHoursPage> with StepActions {
  /// The first period of each day; null = closed that day.
  final _days = <String, TimeRange?>{};

  /// Further periods of a day, saved unchanged.
  final _extra = <String, List<TimeRange>>{};

  @override
  void initState() {
    super.initState();
    final h = ref.read(onboardingProvider).value?.merchant.hours;
    for (final d in weekDays) {
      final ranges = h == null ? [const TimeRange('09:00', '21:00')] : [...(h[d] ?? const <TimeRange>[])]..sort((a, b) => a.open.compareTo(b.open));
      _days[d] = ranges.firstOrNull;
      _extra[d] = ranges.skip(1).toList();
    }
  }

  Future<void> _pick(String day, bool open) async {
    final r = _days[day]!;
    final cur = (open ? r.open : r.close).split(':');
    final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.parse(cur[0]), minute: int.parse(cur[1])));
    if (t == null) return;
    final v = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    setState(() => _days[day] = open ? TimeRange(v, r.close) : TimeRange(r.open, v));
  }

  /// Copies [day]'s hours to every other open day.
  void _copyToAll(String day) {
    final r = _days[day];
    if (r == null) return;
    setState(() {
      for (final d in weekDays) {
        if (_days[d] != null) _days[d] = r;
      }
    });
  }

  bool get _valid => _days.values.any((r) => r != null) && _days.values.every((r) => r == null || r.open != r.close);

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final firstOpen = weekDays.where((d) => _days[d] != null).firstOrNull;
    return StepScaffold(
      title: l.storeHours,
      busy: busy,
      error: error,
      actionLabel: l.save,
      onAction: () {
        if (!_valid) return setState(() => error = l.errHours);
        run(() async {
          await ref.read(onboardingProvider.notifier).saveHours({
            for (final d in weekDays) d: [?_days[d], if (_days[d] != null) ..._extra[d]!],
          });
          if (!context.mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.storeHoursSaved)));
          context.pop();
        });
      },
      children: [
        Text(l.storeHoursHint, style: const TextStyle(color: SanthaColors.slate)),
        const SizedBox(height: SanthaSpacing.s3),
        for (final d in weekDays) _dayRow(l, text, d),
        if (firstOpen != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: const ValueKey('hours-copy-all'),
              icon: const Icon(Icons.copy_all_outlined, size: 18),
              label: Text(l.hoursCopyToAll(l.dayLabel(firstOpen))),
              onPressed: () => _copyToAll(firstOpen),
            ),
          ),
      ],
    );
  }

  Widget _dayRow(AppLocalizations l, TextTheme text, String d) {
    final r = _days[d];
    final extra = _extra[d]!;
    return Padding(
      key: ValueKey('hours-$d'),
      padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s1),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          SizedBox(width: 56, child: Text(l.dayLabel(d), style: text.titleSmall)),
          Semantics(
            label: '${l.dayLabel(d)} ${r == null ? l.hoursClosedDay : l.storeOpen}',
            child: Switch(
              key: ValueKey('hours-$d-open'),
              value: r != null,
              activeTrackColor: SanthaColors.leaf,
              onChanged: (on) => setState(() => _days[d] = on ? (_days[weekDays.firstWhere((x) => _days[x] != null, orElse: () => d)] ?? const TimeRange('09:00', '21:00')) : null),
            ),
          ),
          const SizedBox(width: SanthaSpacing.s2),
          if (r == null)
            Expanded(child: Text(l.hoursClosedDay, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)))
          else ...[
            Expanded(child: _TimeField(key: ValueKey('hours-$d-from'), label: l.hoursOpen, value: r.open, onTap: () => _pick(d, true))),
            const SizedBox(width: SanthaSpacing.s2),
            Expanded(child: _TimeField(key: ValueKey('hours-$d-to'), label: l.hoursClose, value: r.close, onTap: () => _pick(d, false))),
          ],
        ]),
        if (r != null && r.close.compareTo(r.open) < 0)
          Padding(
            padding: const EdgeInsets.only(left: 56),
            child: Text(l.hoursNextDay(r.close), key: ValueKey('hours-$d-overnight'), style: text.bodySmall?.copyWith(color: SanthaColors.indigo)),
          ),
        if (r != null && extra.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(left: 56),
            child: Text(l.hoursAlsoOpen(extra.map((x) => '${x.open}–${x.close}').join(', ')), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
          ),
      ]),
    );
  }
}

class _TimeField extends StatelessWidget {
  const _TimeField({super.key, required this.label, required this.value, required this.onTap});
  final String label;
  final String value;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: '$label $value',
        excludeSemantics: true,
        child: InkWell(
          onTap: onTap,
          child: InputDecorator(decoration: InputDecoration(labelText: label, isDense: true, suffixIcon: const Icon(Icons.schedule, size: 18)), child: Text(value)),
        ),
      );
}
