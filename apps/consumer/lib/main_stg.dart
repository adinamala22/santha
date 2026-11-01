import 'package:santha_core/santha_core.dart';

import 'app.dart';
import 'flavors.dart';

Future<void> main() => bootstrap(configFor(Flavor.stg), const SanthaConsumerApp());
