import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/onboarding_controller.dart';
import 'copy.dart';
import '../../orders/presentation/merchant_home.dart';
import 'start_page.dart';
import 'widgets.dart';
import '../../../support.dart';

/// Merchant home: start → checklist → under review → live (orders home, M5), driven by GET /merchants/me.
class OnboardingGate extends ConsumerWidget {
  const OnboardingGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    return ref.watch(onboardingProvider).when(
          loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
          error: (e, _) => _ErrorPage(message: l.apiError(e), onRetry: () => ref.read(onboardingProvider.notifier).reload()),
          data: (view) => switch (view?.merchant.status) {
            null => const StartPage(),
            MerchantStatus.draft || MerchantStatus.rejected => ChecklistPage(view: view!),
            MerchantStatus.live => MerchantHome(view: view!),
            _ => StatusPage(view: view!),
          },
        );
  }
}

class ChecklistPage extends ConsumerStatefulWidget {
  const ChecklistPage({super.key, required this.view});
  final MerchantView view;

  @override
  ConsumerState<ChecklistPage> createState() => _ChecklistPageState();
}

class _ChecklistPageState extends ConsumerState<ChecklistPage> with StepActions {
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final v = widget.view;
    final m = v.merchant;
    final done = v.checklist.where((c) => c.done).length;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(m.name),
        actions: [
          IconButton(
            tooltip: l.signOut,
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(onboardingProvider.notifier).reload(),
        child: ListView(
          padding: const EdgeInsets.all(SanthaSpacing.s6),
          children: [
            if (m.status == MerchantStatus.rejected)
              Container(
                key: const ValueKey('rejected-banner'),
                margin: const EdgeInsets.only(bottom: SanthaSpacing.s6),
                padding: const EdgeInsets.all(SanthaSpacing.s4),
                decoration: BoxDecoration(color: SanthaColors.chilli.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(SanthaRadius.md)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(l.onbRejectedTitle, style: text.titleMedium?.copyWith(color: SanthaColors.chilli)),
                  const SizedBox(height: SanthaSpacing.s1),
                  Text(l.rejection(m.rejectionCode)),
                  if (m.rejectionNote != null) Text(m.rejectionNote!, style: text.bodySmall),
                ]),
              ),
            Text(l.onbChecklistTitle, style: text.headlineSmall),
            const SizedBox(height: SanthaSpacing.s2),
            Text(l.onbChecklistSub(done, v.checklist.length), style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
            const SizedBox(height: SanthaSpacing.s4),
            LinearProgressIndicator(
              value: v.checklist.isEmpty ? 0 : done / v.checklist.length,
              color: SanthaColors.leaf,
              backgroundColor: SanthaColors.indigo100,
              minHeight: 6,
              borderRadius: BorderRadius.circular(SanthaRadius.pill),
            ),
            const SizedBox(height: SanthaSpacing.s4),
            for (final item in v.checklist) _StepTile(item: item, failed: _failed(v, item.key)),
            const Divider(height: SanthaSpacing.s8),
            ListTile(
              key: const ValueKey('staff-tile'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.delivery_dining, color: SanthaColors.indigo),
              title: Text(l.onbStaff),
              subtitle: Text(v.staff.isEmpty ? l.onbStaffSub : v.staff.map((s) => s.name).join(', ')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/onboarding/staff'),
            ),
            ListTile(
              key: const ValueKey('catalogue-tile'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.inventory_2, color: SanthaColors.indigo),
              title: Text(l.catOpen),
              subtitle: Text(l.catOpenSub),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/catalogue'),
            ),
            const SizedBox(height: SanthaSpacing.s6),
            if (error != null) Text(error!, style: const TextStyle(color: SanthaColors.chilli)),
            SanthaButton(
              key: const ValueKey('submit'),
              label: l.onbSubmit,
              loading: busy,
              onPressed: v.canSubmit && !busy ? () => run(() => ref.read(onboardingProvider.notifier).submit()) : null,
            ),
            if (!v.canSubmit)
              Padding(
                padding: const EdgeInsets.only(top: SanthaSpacing.s2),
                child: Text(l.onbSubmitHint, textAlign: TextAlign.center, style: text.bodySmall?.copyWith(color: SanthaColors.slate)),
              ),
          ],
        ),
      ),
    );
  }

  bool _failed(MerchantView v, ChecklistKey k) {
    final kind = switch (k) {
      ChecklistKey.pan => KycKind.pan,
      ChecklistKey.aadhaar => KycKind.aadhaar,
      ChecklistKey.fssai => KycKind.fssai,
      ChecklistKey.bank => KycKind.bank,
      ChecklistKey.gst => KycKind.gstin,
      _ => null,
    };
    return kind != null && v.check(kind)?.status == KycStatus.failed && !v.done(k);
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({required this.item, required this.failed});
  final ChecklistItem item;
  final bool failed;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final (icon, color, status) = item.done
        ? (Icons.check_circle, SanthaColors.leaf, l.stepDone)
        : failed
            ? (Icons.error, SanthaColors.chilli, l.stepFailed)
            : (Icons.radio_button_unchecked, SanthaColors.indigo300, l.stepTodo);
    return ListTile(
      key: ValueKey('step-${item.key.wire}'),
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: color),
      title: Text(l.stepTitle(item.key)),
      subtitle: Text(status, style: TextStyle(color: color)),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push('/onboarding/${item.key.wire}'),
    );
  }
}

/// Submitted / approved / live.
class StatusPage extends ConsumerWidget {
  const StatusPage({super.key, required this.view});
  final MerchantView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final market = view.microMarket == null ? '' : (locale == 'te' ? view.microMarket!.nameTe : view.microMarket!.name);
    final (icon, title, sub) = switch (view.merchant.status) {
      MerchantStatus.live => (Icons.storefront, l.statusLiveTitle, l.statusLiveSub(market)),
      MerchantStatus.approved => (Icons.task_alt, l.statusApprovedTitle, l.statusApprovedSub),
      _ => (Icons.hourglass_top, l.statusSubmittedTitle, l.statusSubmittedSub),
    };
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: SanthaColors.indigo,
        foregroundColor: SanthaColors.white,
        title: Text(view.merchant.name),
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(onboardingProvider.notifier).reload(),
        child: ListView(
          padding: const EdgeInsets.all(SanthaSpacing.s6),
          children: [
            const SizedBox(height: SanthaSpacing.s8),
            Icon(icon, size: 72, color: view.merchant.status == MerchantStatus.live ? SanthaColors.leaf : SanthaColors.marigold),
            const SizedBox(height: SanthaSpacing.s6),
            Text(title, style: text.headlineSmall, textAlign: TextAlign.center, key: const ValueKey('status-title')),
            const SizedBox(height: SanthaSpacing.s3),
            Text(sub, style: text.bodyMedium?.copyWith(color: SanthaColors.slate), textAlign: TextAlign.center),
            const SizedBox(height: SanthaSpacing.s8),
            Card(
              child: ListTile(
                key: const ValueKey('open-catalogue'),
                leading: const Icon(Icons.inventory_2, color: SanthaColors.indigo),
                title: Text(l.catOpen),
                subtitle: Text(l.catOpenSub),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/catalogue'),
              ),
            ),
            Card(
              child: ListTile(
                key: const ValueKey('open-support'),
                leading: Badge(
                  isLabelVisible: ref.watch(supportUnreadProvider) > 0,
                  label: Text('${ref.watch(supportUnreadProvider)}'),
                  child: const Icon(Icons.support_agent, color: SanthaColors.indigo),
                ),
                title: Text(l.supportTitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SupportInboxPage(strings: supportStrings(l), topics: supportTopics))),
              ),
            ),
            if (view.merchant.status == MerchantStatus.live)
              Card(
                child: ListTile(
                  key: const ValueKey('open-hours'),
                  leading: const Icon(Icons.schedule, color: SanthaColors.indigo),
                  title: Text(l.storeHours),
                  subtitle: Text(l.storeHoursSub),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/hours'),
                ),
              ),
            if (view.merchant.status == MerchantStatus.live && view.merchant.type != MerchantType.fashion)
              Card(
                child: SwitchListTile(
                  key: const ValueKey('delivers-anywhere'),
                  secondary: const Icon(Icons.two_wheeler, color: SanthaColors.indigo),
                  title: Text(l.deliverAnywhereTitle),
                  subtitle: Text(l.deliverAnywhereSub(l.distanceKm((view.merchant.radiusM / 1000).toStringAsFixed(view.merchant.radiusM % 1000 == 0 ? 0 : 1)))),
                  value: view.merchant.deliversAnywhere,
                  onChanged: (on) async {
                    try {
                      await ref.read(onboardingProvider.notifier).setDeliversAnywhere(on);
                    } catch (e) {
                      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.apiError(e))));
                    }
                  },
                ),
              ),
            const SizedBox(height: SanthaSpacing.s6),
            SanthaButton(label: l.refresh, variant: SanthaButtonVariant.outline, onPressed: () => ref.read(onboardingProvider.notifier).reload()),
            const SizedBox(height: SanthaSpacing.s3),
            SanthaButton(label: l.signOut, variant: SanthaButtonVariant.outline, onPressed: () => ref.read(authControllerProvider.notifier).signOut()),
          ],
        ),
      ),
    );
  }
}

class _ErrorPage extends StatelessWidget {
  const _ErrorPage({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(SanthaSpacing.s6),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: SanthaSpacing.s6),
            SanthaButton(label: l.retry, onPressed: onRetry),
          ]),
        ),
      ),
    );
  }
}
