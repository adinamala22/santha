import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../onboarding/presentation/copy.dart';
import '../data/catalogue_controller.dart';
import 'catalogue_copy.dart';

final slotsProvider = FutureProvider.autoDispose<SlotList>((ref) => ref.watch(catalogueApiProvider).slots());

/// Home-kitchen delivery slots (FR-CAT-5): windows per day with cut-off and capacity. Saved as a
/// set; the backend refuses overlaps.
class SlotsPage extends ConsumerStatefulWidget {
  const SlotsPage({super.key});
  @override
  ConsumerState<SlotsPage> createState() => _SlotsPageState();
}

class _SlotsPageState extends ConsumerState<SlotsPage> {
  List<Slot>? _slots;
  SlotOccurrence? _next;
  bool _busy = false;
  String? _error;

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final english = Localizations.localeOf(context).languageCode == 'en';
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(catalogueApiProvider).saveSlots(_slots!);
      setState(() {
        _slots = r.slots;
        _next = r.nextOpen;
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.slotsSaved)));
    } catch (e) {
      setState(() => _error = l.catalogueError(e, english: english));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit([int? index]) async {
    final slot = await showModalBottomSheet<Slot>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _SlotSheet(initial: index == null ? null : _slots![index]),
    );
    if (slot == null) return;
    setState(() {
      if (index == null) {
        _slots = [..._slots!, slot];
      } else {
        _slots = [..._slots!]..[index] = slot;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final async = ref.watch(slotsProvider);
    if (_slots == null && async.hasValue) {
      _slots = async.value!.slots;
      _next = async.value!.nextOpen;
    }
    return Scaffold(
      appBar: AppBar(title: Text(l.slotsTitle)),
      floatingActionButton: _slots == null ? null : FloatingActionButton.extended(key: const ValueKey('slot-add'), onPressed: () => _edit(), icon: const Icon(Icons.add), label: Text(l.slotAdd)),
      body: _slots == null
          ? Center(child: async.hasError ? Text(l.apiError(async.error!)) : const CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(SanthaSpacing.s6, SanthaSpacing.s6, SanthaSpacing.s6, 96),
              children: [
                Text(l.slotsSub, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
                if (_next != null)
                  Padding(
                    padding: const EdgeInsets.only(top: SanthaSpacing.s3),
                    child: Text(l.slotNext(_next!.date, _next!.start, _next!.end), style: text.bodyMedium?.copyWith(color: SanthaColors.leaf)),
                  ),
                const SizedBox(height: SanthaSpacing.s4),
                if (_slots!.isEmpty) Padding(padding: const EdgeInsets.all(SanthaSpacing.s6), child: Text(l.slotsEmpty, textAlign: TextAlign.center)),
                for (final (i, s) in _slots!.indexed)
                  Card(
                    key: ValueKey('slot-$i'),
                    child: ListTile(
                      title: Text(s.label ?? '${s.start}–${s.end}'),
                      subtitle: Text('${s.days.map(l.dayLabel).join(', ')}\n${l.slotSummary(s.start, s.end, s.cutoffMin, s.capacity)}'),
                      isThreeLine: true,
                      onTap: () => _edit(i),
                      trailing: IconButton(tooltip: l.slotRemove, icon: const Icon(Icons.delete_outline), onPressed: () => setState(() => _slots = [..._slots!]..removeAt(i))),
                    ),
                  ),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: SanthaSpacing.s4), child: Text(_error!, key: const ValueKey('slots-error'), style: const TextStyle(color: SanthaColors.chilli))),
                const SizedBox(height: SanthaSpacing.s6),
                SanthaButton(key: const ValueKey('slots-save'), label: l.save, loading: _busy, onPressed: _busy ? null : _save),
              ],
            ),
    );
  }
}

class _SlotSheet extends StatefulWidget {
  const _SlotSheet({this.initial});
  final Slot? initial;
  @override
  State<_SlotSheet> createState() => _SlotSheetState();
}

class _SlotSheetState extends State<_SlotSheet> {
  late final _label = TextEditingController(text: widget.initial?.label ?? '');
  late final _cutoff = TextEditingController(text: '${widget.initial?.cutoffMin ?? 90}');
  late final _capacity = TextEditingController(text: '${widget.initial?.capacity ?? 10}');
  late String _start = widget.initial?.start ?? '12:30';
  late String _end = widget.initial?.end ?? '13:00';
  late final Set<String> _days = {...(widget.initial?.days ?? weekDays)};

  Future<String?> _time(String current) async {
    final parts = current.split(':');
    final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1])));
    return t == null ? null : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _label.dispose();
    _cutoff.dispose();
    _capacity.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final digits = [FilteringTextInputFormatter.digitsOnly];
    return Padding(
      padding: EdgeInsets.fromLTRB(SanthaSpacing.s6, SanthaSpacing.s6, SanthaSpacing.s6, MediaQuery.viewInsetsOf(context).bottom + SanthaSpacing.s6),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(key: const ValueKey('slot-label'), controller: _label, decoration: InputDecoration(labelText: l.slotLabel)),
        const SizedBox(height: SanthaSpacing.s3),
        Row(children: [
          Expanded(
            child: OutlinedButton(
              key: const ValueKey('slot-start'),
              onPressed: () async {
                final t = await _time(_start);
                if (t != null) setState(() => _start = t);
              },
              child: Text('${l.slotStart} $_start'),
            ),
          ),
          const SizedBox(width: SanthaSpacing.s3),
          Expanded(
            child: OutlinedButton(
              key: const ValueKey('slot-end'),
              onPressed: () async {
                final t = await _time(_end);
                if (t != null) setState(() => _end = t);
              },
              child: Text('${l.slotEnd} $_end'),
            ),
          ),
        ]),
        const SizedBox(height: SanthaSpacing.s3),
        Text(l.slotDays),
        Wrap(spacing: SanthaSpacing.s1, children: [
          for (final d in weekDays) FilterChip(label: Text(l.dayLabel(d)), selected: _days.contains(d), onSelected: (on) => setState(() => on ? _days.add(d) : _days.remove(d))),
        ]),
        const SizedBox(height: SanthaSpacing.s3),
        Row(children: [
          Expanded(child: TextField(key: const ValueKey('slot-cutoff'), controller: _cutoff, keyboardType: TextInputType.number, inputFormatters: digits, decoration: InputDecoration(labelText: l.slotCutoff))),
          const SizedBox(width: SanthaSpacing.s3),
          Expanded(child: TextField(key: const ValueKey('slot-capacity'), controller: _capacity, keyboardType: TextInputType.number, inputFormatters: digits, decoration: InputDecoration(labelText: l.slotCapacity))),
        ]),
        const SizedBox(height: SanthaSpacing.s6),
        SanthaButton(
          key: const ValueKey('slot-done'),
          label: l.done,
          onPressed: _days.isEmpty || _start.compareTo(_end) >= 0
              ? null
              : () => Navigator.pop(
                    context,
                    Slot(
                      label: _label.text.trim().isEmpty ? null : _label.text.trim(),
                      days: weekDays.where(_days.contains).toList(),
                      start: _start,
                      end: _end,
                      cutoffMin: int.tryParse(_cutoff.text) ?? 0,
                      capacity: (int.tryParse(_capacity.text) ?? 1).clamp(1, 500),
                    ),
                  ),
        ),
      ]),
    );
  }
}
