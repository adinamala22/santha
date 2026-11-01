import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../data/onboarding_controller.dart';
import 'copy.dart';
import 'widgets.dart';

/// Onboarding step 1 (PRD 9.4): business type, shop name, food / category.
class StartPage extends ConsumerStatefulWidget {
  const StartPage({super.key});

  @override
  ConsumerState<StartPage> createState() => _StartPageState();
}

class _StartPageState extends ConsumerState<StartPage> with StepActions {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  MerchantType? _type;
  bool _sellsFood = false;
  String? _category;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return StepScaffold(
      title: l.onbStartTitle,
      formKey: _form,
      busy: busy,
      error: error,
      actionLabel: l.onbContinue,
      onAction: _type == null
          ? null
          : () {
              if (!_form.currentState!.validate()) return;
              run(() => ref.read(onboardingProvider.notifier).create(
                    type: _type!,
                    name: _name.text.trim(),
                    sellsFood: _type == MerchantType.retail || _type == MerchantType.homeBusiness ? _sellsFood : null,
                    category: _type == MerchantType.retail ? _category : null,
                  ));
            },
      children: [
        Text(l.onbStartSub, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
        const SizedBox(height: SanthaSpacing.s6),
        for (final t in MerchantType.values)
          Padding(
            padding: const EdgeInsets.only(bottom: SanthaSpacing.s3),
            child: _TypeCard(
              key: ValueKey('type-${t.wire}'),
              title: l.typeTitle(t),
              subtitle: l.typeSub(t),
              selected: _type == t,
              onTap: () => setState(() {
                _type = t;
                if (t == MerchantType.homeKitchen) _sellsFood = true;
              }),
            ),
          ),
        if (_type != null) ...[
          const SizedBox(height: SanthaSpacing.s4),
          TextFormField(
            key: const ValueKey('shop-name'),
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(labelText: l.onbShopName, hintText: l.onbShopNameHint),
            validator: (v) => (v == null || v.trim().length < 2) ? l.errRequired : null,
          ),
          if (_type == MerchantType.retail) ...[
            gap,
            DropdownButtonFormField<String>(
              key: const ValueKey('category'),
              initialValue: _category,
              decoration: InputDecoration(labelText: l.onbCategory),
              items: [for (final c in retailCategories) DropdownMenuItem(value: c, child: Text(l.category(c)))],
              onChanged: (c) => setState(() {
                _category = c;
                if (c == 'kirana' || c == 'supermarket' || c == 'bakery' || c == 'meat_fish' || c == 'fruits_vegetables') _sellsFood = true;
              }),
              validator: (v) => v == null ? l.errRequired : null,
            ),
          ],
          if (_type == MerchantType.retail || _type == MerchantType.homeBusiness)
            SwitchListTile(
              key: const ValueKey('sells-food'),
              contentPadding: EdgeInsets.zero,
              value: _sellsFood,
              onChanged: (v) => setState(() => _sellsFood = v),
              title: Text(l.onbSellsFood),
              subtitle: Text(l.onbSellsFoodSub),
            ),
        ],
      ],
    );
  }
}

class _TypeCard extends StatelessWidget {
  const _TypeCard({super.key, required this.title, required this.subtitle, required this.selected, required this.onTap});
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? SanthaColors.sky : SanthaColors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(SanthaRadius.md),
          side: BorderSide(color: selected ? SanthaColors.indigo : SanthaColors.indigo100, width: selected ? 2 : 1),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(SanthaRadius.md),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(SanthaSpacing.s4),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: SanthaSpacing.s1),
                  Text(subtitle, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: SanthaColors.slate)),
                ]),
              ),
              Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off, color: SanthaColors.indigo),
            ]),
          ),
        ),
      ),
    );
  }
}
