import 'package:consumer/data/format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('rupees: integer paise, Indian grouping, paise only when needed', () {
    expect(rupees(6000), '₹60');
    expect(rupees(145000), '₹1,450');
    expect(rupees(12345678), '₹1,23,456.78');
    expect(rupees(99), '₹0.99');
  });

  test('clock and slot ranges', () {
    expect(clock('00:30'), '12:30 am');
    expect(clock('19:30'), '7:30 pm');
    expect(slotRange('12:30', '13:00'), '12:30–1:00 pm');
    expect(slotRange('11:30', '12:30'), '11:30 am–12:30 pm');
  });

  test('istClock converts UTC instants to IST', () {
    expect(istClock(DateTime.utc(2026, 11, 2, 12)), '5:30 pm');
  });
}
