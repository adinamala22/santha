import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../onboarding/data/onboarding_controller.dart';
import '../../onboarding/presentation/copy.dart';
import '../../onboarding/presentation/widgets.dart';

/// Store hours for a live store (ADR-021): opening and closing time and closed days. Customers see the
/// store open in these hours; the Open switch opens it outside them until the next close.
class StoreHoursPage extends ConsumerStatefulWidget {
  const StoreHoursPage({super.key});
  @override
  ConsumerState<StoreHoursPage> createState() => _StoreHoursPageState();
}

class _StoreHoursPageState extends ConsumerState<StoreHoursPage> with StepActions {
  String _open = '09:00';
  String _close = '21:00';
  Set<String> _closed = {};

  @override
  void initState() {
    super.initState();
    final h = ref.read(onboardingProvider).value?.merchant.hours;
    final first = h?.values.expand((r) => r).firstOrNull;
    if (first != null) {
      _open = first.open;
      _close = first.close;
    }
    _closed = {for (final d in weekDays) if (h != null && (h[d] ?? const []).isEmpty) d};
  }

  Future<void> _pick(bool open) async {
    final cur = (open ? _open : _close).split(':');
    final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.parse(cur[0]), minute: int.parse(cur[1])));
    if (t == null) return;
    final v = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    setState(() => open ? _open = v : _close = v);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return StepScaffold(
      title: l.storeHours,
      busy: busy,
      error: error,
      actionLabel: l.save,
      onAction: () {
        if (_open.compareTo(_close) >= 0 || _closed.length == 7) return setState(() => error = l.errHours);
        run(() async {
          await ref.read(onboardingProvider.notifier).saveHours({for (final d in weekDays) d: _closed.contains(d) ? <TimeRange>[] : [TimeRange(_open, _close)]});
          if (!context.mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.storeHoursSaved)));
          context.pop();
        });
      },
      children: [
        Text(l.storeHoursHint, style: const TextStyle(color: SanthaColors.slate)),
        const SizedBox(height: SanthaSpacing.s4),
        Row(children: [
          Expanded(child: _TimeField(key: const ValueKey('hours-open'), label: l.hoursOpen, value: _open, onTap: () => _pick(true))),
          const SizedBox(width: SanthaSpacing.s3),
          Expanded(child: _TimeField(key: const ValueKey('hours-close'), label: l.hoursClose, value: _close, onTap: () => _pick(false))),
        ]),
        const SizedBox(height: SanthaSpacing.s4),
        Text(l.hoursClosedOn),
        Wrap(spacing: SanthaSpacing.s2, children: [
          for (final d in weekDays)
            FilterChip(
              label: Text(l.dayLabel(d)),
              selected: _closed.contains(d),
              onSelected: (s) => setState(() => s ? _closed.add(d) : _closed.remove(d)),
            ),
        ]),
      ],
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
        child: InkWell(
          onTap: onTap,
          child: InputDecorator(decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.schedule)), child: Text(value)),
        ),
      );
}
