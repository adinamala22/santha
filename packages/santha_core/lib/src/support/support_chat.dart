import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../analytics/analytics.dart';
import '../auth/auth_controller.dart';
import '../push/push.dart';
import '../realtime/realtime.dart';

/// Copy for the support chat screens, supplied by each app in its language (en/te), like [OtpLoginStrings].
class SupportStrings {
  const SupportStrings({
    required this.title,
    required this.intro,
    required this.newChat,
    required this.empty,
    required this.topicTitle,
    required this.messageHint,
    required this.send,
    required this.start,
    required this.support,
    required this.waitingSupport,
    required this.waitingCustomer,
    required this.resolved,
    required this.resolvedNote,
    required this.orderLabel,
    required this.topicLabel,
    required this.tooManyOpen,
    required this.slowDown,
    required this.closed,
    required this.errorNetwork,
    required this.errorGeneric,
    required this.loading,
    required this.retry,
  });

  final String title;

  /// Under the title: when support answers.
  final String intro;
  final String newChat;
  final String empty;
  final String topicTitle;
  final String messageHint;
  final String send;
  final String start;

  /// The sender name on support's messages ("Santha support").
  final String support;
  final String waitingSupport;
  final String waitingCustomer;
  final String resolved;
  final String resolvedNote;
  final String Function(String code) orderLabel;
  final String Function(String topic) topicLabel;
  final String tooManyOpen;
  final String slowDown;
  final String closed;
  final String errorNetwork;
  final String errorGeneric;
  final String loading;
  final String retry;

  String status(SupportStatus s) => switch (s) {
        SupportStatus.waitingSupport => waitingSupport,
        SupportStatus.waitingCustomer => waitingCustomer,
        SupportStatus.resolved => resolved,
      };

  String error(Object e) {
    if (e is! ApiException) return errorGeneric;
    return switch (e.code) {
      ApiException.network => errorNetwork,
      'RATE_LIMITED' => e.details['openThreads'] != null ? tooManyOpen : slowDown,
      'INVALID_STATE' => closed,
      _ => errorGeneric,
    };
  }
}

Duration? _noRetry(int retryCount, Object error) => null;

final supportApiProvider = Provider<SupportApi>((ref) => SupportApi(ref.watch(apiClientProvider)));

/// How often an open chat re-checks for replies when no realtime event arrives. Tests: null.
final supportPollEveryProvider = Provider<Duration?>((ref) => const Duration(seconds: 15));

/// My chats, latest first. Refreshes on realtime `support.message`.
final supportThreadsProvider = FutureProvider.autoDispose<List<SupportThread>>(retry: _noRetry, (ref) {
  ref.listen(realtimeEventsProvider, (_, next) {
    if (next.value?.name == 'support.message') ref.invalidateSelf();
  });
  return ref.watch(supportApiProvider).threads();
});

/// Chats with support replies not read yet (a badge on the Help entry).
final supportUnreadProvider = Provider.autoDispose<int>((ref) => ref.watch(supportThreadsProvider).value?.fold<int>(0, (n, t) => n + t.unread) ?? 0);

/// One chat; refreshed by realtime and by polling while it is open. Writing replaces it with the server's copy.
final supportThreadProvider = AsyncNotifierProvider.autoDispose.family<SupportThreadController, SupportThread, String>(SupportThreadController.new);

class SupportThreadController extends AsyncNotifier<SupportThread> {
  SupportThreadController(this.id);
  final String id;

  @override
  Future<SupportThread> build() async {
    ref.listen(realtimeEventsProvider, (_, next) {
      final e = next.value;
      if (e?.name == 'support.message' && e?.data['threadId'] == id) unawaited(reload());
    });
    final every = ref.watch(supportPollEveryProvider);
    if (every != null) {
      final timer = Timer.periodic(every, (_) => unawaited(reload()));
      ref.onDispose(timer.cancel);
    }
    return ref.read(supportApiProvider).thread(id);
  }

  Future<void> reload() async {
    final next = await AsyncValue.guard(() => ref.read(supportApiProvider).thread(id));
    if (next.hasValue) state = next; // keep the chat on screen if a refresh fails
  }

  Future<void> write(String body) async {
    state = AsyncData(await ref.read(supportApiProvider).write(id, body));
    ref.read(analyticsProvider).track('support_message_sent', {'thread_id': id, 'length': body.length});
    ref.invalidate(supportThreadsProvider);
  }
}

/// Asks for the topic and the first message, starts the chat (or continues the one about [orderId]) and opens it.
Future<void> startSupportChat(
  BuildContext context,
  WidgetRef ref, {
  required SupportStrings strings,
  required List<String> topics,
  String? orderId,
  String? orderCode,
  String? initialTopic,
}) async {
  final picked = await showModalBottomSheet<(String, String)>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _NewChatSheet(strings: strings, topics: topics, orderCode: orderCode, initialTopic: initialTopic),
  );
  if (picked == null || !context.mounted) return;
  final messenger = ScaffoldMessenger.of(context);
  final nav = Navigator.of(context);
  try {
    final t = await ref.read(supportApiProvider).open(topic: picked.$1, body: picked.$2, orderId: orderId);
    ref.read(analyticsProvider).track('support_thread_opened', {'topic': picked.$1, 'has_order': orderId != null});
    ref.invalidate(supportThreadsProvider);
    await nav.push(MaterialPageRoute<void>(builder: (_) => SupportChatPage(threadId: t.id, strings: strings)));
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(strings.error(e))));
  }
}

/// Help & support: my chats and "New chat".
class SupportInboxPage extends ConsumerWidget {
  const SupportInboxPage({super.key, required this.strings, required this.topics});
  final SupportStrings strings;
  final List<String> topics;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = strings;
    final text = Theme.of(context).textTheme;
    final threads = ref.watch(supportThreadsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s.title)),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('support-new'),
        backgroundColor: SanthaColors.indigo,
        foregroundColor: SanthaColors.white,
        icon: const Icon(Icons.chat_bubble_outline),
        label: Text(s.newChat),
        onPressed: () => startSupportChat(context, ref, strings: s, topics: topics),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(supportThreadsProvider.future),
        child: ListView(padding: const EdgeInsets.fromLTRB(SanthaSpacing.s4, SanthaSpacing.s4, SanthaSpacing.s4, 96), children: [
          Text(s.intro, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s4),
          ...switch (threads) {
            AsyncData(:final value) when value.isEmpty => [
                Padding(padding: const EdgeInsets.symmetric(vertical: SanthaSpacing.s8), child: Text(s.empty, key: const ValueKey('support-empty'), textAlign: TextAlign.center, style: text.bodyMedium?.copyWith(color: SanthaColors.slate))),
              ],
            AsyncData(:final value) => [for (final t in value) _ThreadTile(thread: t, strings: s)],
            AsyncError(:final error) => [
                Text(s.error(error), textAlign: TextAlign.center),
                const SizedBox(height: SanthaSpacing.s3),
                SanthaButton(label: s.retry, variant: SanthaButtonVariant.outline, onPressed: () => ref.invalidate(supportThreadsProvider)),
              ],
            _ => [Center(child: Semantics(label: s.loading, child: const CircularProgressIndicator()))],
          },
        ]),
      ),
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({required this.thread, required this.strings});
  final SupportThread thread;
  final SupportStrings strings;

  @override
  Widget build(BuildContext context) {
    final t = thread;
    final s = strings;
    final text = Theme.of(context).textTheme;
    final title = [s.topicLabel(t.topic), if (t.orderCode != null) s.orderLabel(t.orderCode!)].join(' · ');
    return Card(
      key: ValueKey('support-thread-${t.id}'),
      margin: const EdgeInsets.only(bottom: SanthaSpacing.s3),
      child: ListTile(
        title: Text(title, style: text.titleSmall),
        subtitle: Text('${s.status(t.status)} · ${t.lastMessagePreview}', maxLines: 2, overflow: TextOverflow.ellipsis),
        trailing: t.unread > 0
            ? Badge(key: ValueKey('support-unread-${t.id}'), label: Text('${t.unread}'), backgroundColor: SanthaColors.chilli)
            : const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SupportChatPage(threadId: t.id, strings: s))),
      ),
    );
  }
}

/// One conversation: bubbles (mine on the right), and a box to write.
class SupportChatPage extends ConsumerStatefulWidget {
  const SupportChatPage({super.key, required this.threadId, required this.strings});
  final String threadId;
  final SupportStrings strings;

  @override
  ConsumerState<SupportChatPage> createState() => _SupportChatPageState();
}

class _SupportChatPageState extends ConsumerState<SupportChatPage> {
  final _input = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final body = _input.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ref.read(supportThreadProvider(widget.threadId).notifier).write(body);
      _input.clear();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(widget.strings.error(e))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.strings;
    final text = Theme.of(context).textTheme;
    final thread = ref.watch(supportThreadProvider(widget.threadId));
    final t = thread.value;
    return Scaffold(
      appBar: AppBar(
        title: Text(t == null ? s.title : [s.topicLabel(t.topic), if (t.orderCode != null) s.orderLabel(t.orderCode!)].join(' · '), overflow: TextOverflow.ellipsis),
      ),
      body: Column(children: [
        Expanded(
          child: switch (thread) {
            AsyncData(:final value) => ListView(
                key: const ValueKey('support-messages'),
                reverse: true,
                padding: const EdgeInsets.all(SanthaSpacing.s4),
                children: [
                  if (value.status == SupportStatus.resolved)
                    Padding(
                      padding: const EdgeInsets.only(top: SanthaSpacing.s3),
                      child: Text(s.resolvedNote, key: const ValueKey('support-resolved'), textAlign: TextAlign.center, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
                    ),
                  for (final m in value.messages.reversed) _Bubble(message: m, strings: s),
                ],
              ),
            AsyncError(:final error) => Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(s.error(error)),
                  TextButton(onPressed: () => ref.invalidate(supportThreadProvider(widget.threadId)), child: Text(s.retry)),
                ]),
              ),
            _ => Center(child: Semantics(label: s.loading, child: const CircularProgressIndicator())),
          },
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(SanthaSpacing.s3, SanthaSpacing.s2, SanthaSpacing.s2, SanthaSpacing.s2),
            child: Row(children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('support-input'),
                  controller: _input,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: 1000,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(hintText: s.messageHint, counterText: '', border: const OutlineInputBorder()),
                ),
              ),
              const SizedBox(width: SanthaSpacing.s2),
              IconButton.filled(
                key: const ValueKey('support-send'),
                tooltip: s.send,
                style: IconButton.styleFrom(backgroundColor: SanthaColors.indigo, minimumSize: const Size(48, 48)),
                onPressed: _sending ? null : _send,
                icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: SanthaColors.white)) : const Icon(Icons.send, color: SanthaColors.white),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.strings});
  final SupportMessage message;
  final SupportStrings strings;

  @override
  Widget build(BuildContext context) {
    final m = message;
    final text = Theme.of(context).textTheme;
    final mine = !m.fromSupport;
    final ist = m.createdAt.toUtc().add(const Duration(hours: 5, minutes: 30));
    final time = MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay(hour: ist.hour, minute: ist.minute));
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        key: ValueKey('support-msg-${m.id}'),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
        margin: const EdgeInsets.only(bottom: SanthaSpacing.s2),
        padding: const EdgeInsets.all(SanthaSpacing.s3),
        decoration: BoxDecoration(
          color: mine ? SanthaColors.indigo : SanthaColors.indigo100,
          borderRadius: BorderRadius.circular(SanthaRadius.lg),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (!mine) Text(strings.support, style: text.labelSmall?.copyWith(color: SanthaColors.indigo, fontWeight: FontWeight.w700)),
          Text(m.body, style: text.bodyMedium?.copyWith(color: mine ? SanthaColors.white : SanthaColors.ink)),
          Text(time, style: text.labelSmall?.copyWith(color: mine ? SanthaColors.onDarkMuted : SanthaColors.slate)),
        ]),
      ),
    );
  }
}

class _NewChatSheet extends StatefulWidget {
  const _NewChatSheet({required this.strings, required this.topics, this.orderCode, this.initialTopic});
  final SupportStrings strings;
  final List<String> topics;
  final String? orderCode;
  final String? initialTopic;

  @override
  State<_NewChatSheet> createState() => _NewChatSheetState();
}

class _NewChatSheetState extends State<_NewChatSheet> {
  late String? _topic = widget.initialTopic;
  final _body = TextEditingController();

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.strings;
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(SanthaSpacing.s4, SanthaSpacing.s4, SanthaSpacing.s4, MediaQuery.viewInsetsOf(context).bottom + SanthaSpacing.s4),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(s.topicTitle, style: text.titleMedium),
            if (widget.orderCode != null) Text(s.orderLabel(widget.orderCode!), style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
            const SizedBox(height: SanthaSpacing.s3),
            Wrap(spacing: SanthaSpacing.s2, runSpacing: SanthaSpacing.s2, children: [
              for (final t in widget.topics)
                ChoiceChip(
                  key: ValueKey('support-topic-$t'),
                  label: Text(s.topicLabel(t)),
                  selected: _topic == t,
                  onSelected: (_) => setState(() => _topic = t),
                ),
            ]),
            const SizedBox(height: SanthaSpacing.s3),
            TextField(
              key: const ValueKey('support-first-message'),
              controller: _body,
              minLines: 2,
              maxLines: 5,
              maxLength: 1000,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(hintText: s.messageHint, border: const OutlineInputBorder()),
            ),
            SanthaButton(
              key: const ValueKey('support-start'),
              label: s.start,
              onPressed: _topic == null || _body.text.trim().isEmpty ? null : () => Navigator.pop(context, (_topic!, _body.text.trim())),
            ),
          ]),
        ),
      ),
    );
  }
}

/// A tapped support-reply notification (kind `support`, ADR-028) opens its chat on top of the current
/// screen. Returns false for other kinds, which the app routes itself.
bool openSupportFromPush(PushTap tap, NavigatorState? nav, SupportStrings Function() strings) {
  final id = tap.threadId;
  if (tap.kind != 'support' || id == null || nav == null) return false;
  nav.push(MaterialPageRoute<void>(builder: (_) => SupportChatPage(threadId: id, strings: strings())));
  return true;
}
