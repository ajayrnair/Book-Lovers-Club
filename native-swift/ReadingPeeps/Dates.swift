import Foundation

/// Date helpers. Club "days" travel through the API as "yyyy-MM-dd" strings;
/// all parsing/formatting for those is pinned to UTC so the weekday and day
/// number always match the string, whatever the device timezone is.
enum Dates {
    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = format
        return f
    }

    static func parseDay(_ s: String) -> Date? {
        formatter("yyyy-MM-dd").date(from: s)
    }

    static func dayString(_ d: Date) -> String {
        formatter("yyyy-MM-dd").string(from: d)
    }

    static func shiftDay(_ s: String, by days: Int) -> String {
        guard let d = parseDay(s) else { return s }
        let shifted = d.addingTimeInterval(TimeInterval(days * 86400))
        return dayString(shifted)
    }

    static func weekdayShort(_ day: String) -> String {
        guard let d = parseDay(day) else { return "" }
        return formatter("EEE").string(from: d)
    }

    static func dayNumber(_ day: String) -> String {
        guard let d = parseDay(day) else { return "" }
        return formatter("d").string(from: d)
    }

    /// "Tue, Nov 18, 2026" for a "yyyy-MM-dd" string; falls back to the input.
    static func longDate(_ day: String) -> String {
        guard let d = parseDay(day) else { return day }
        return formatter("EEE, MMM d, yyyy").string(from: d)
    }

    /// "Dec 7–13" within a month, "Nov 30 – Dec 6" across months.
    static func rangeLabel(first: String, last: String) -> String {
        guard let a = parseDay(first), let b = parseDay(last) else { return "" }
        let monthA = formatter("MMM").string(from: a)
        let monthB = formatter("MMM").string(from: b)
        let dayA = formatter("d").string(from: a)
        let dayB = formatter("d").string(from: b)
        if monthA == monthB { return "\(monthA) \(dayA)–\(dayB)" }
        return "\(monthA) \(dayA) – \(monthB) \(dayB)"
    }

    static func parseISO(_ s: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }

    /// "now", "5m", "2h", "3d" for recent timestamps, else "Nov 17".
    static func relativeLabel(iso: String) -> String {
        guard let d = parseISO(iso) else { return "" }
        let secs = Date().timeIntervalSince(d)
        if secs < 90 { return "now" }
        let mins = Int(secs / 60)
        if mins < 60 { return "\(mins)m" }
        let hours = mins / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        if days < 7 { return "\(days)d" }
        return shortDate(iso: iso)
    }

    /// "Nov 17" for an ISO timestamp string.
    static func shortDate(iso: String) -> String {
        guard let d = parseISO(iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "MMM d"
        return f.string(from: d)
    }

    /// "19:30" -> "7:30 PM"; empty or unparseable -> "".
    static func timeLabel(_ hhmm: String?) -> String {
        guard let hhmm = hhmm, !hhmm.isEmpty else { return "" }
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return "" }
        var hour = h % 12
        if hour == 0 { hour = 12 }
        return String(format: "%d:%02d %@", hour, m, h >= 12 ? "PM" : "AM")
    }

    /// A Date on the current day at the given "HH:mm" (device-local), for DatePicker binding.
    static func dateFromTime(_ hhmm: String?) -> Date {
        var comps = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        if let hhmm = hhmm {
            let parts = hhmm.split(separator: ":")
            if parts.count == 2 {
                comps.hour = Int(parts[0]) ?? 19
                comps.minute = Int(parts[1]) ?? 0
            }
        }
        if comps.hour == nil { comps.hour = 19; comps.minute = 0 }
        return Calendar.current.date(from: comps) ?? Date()
    }

    /// "HH:mm" from a Date (device-local), the meeting-time wire format.
    static func timeString(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }

    /// Default poll end: a week out, or the day before the meeting if sooner.
    static func defaultPollEnd(meetingDate: String) -> String {
        let week = dayString(Date().addingTimeInterval(7 * 86400))
        if !meetingDate.isEmpty, parseDay(meetingDate) != nil {
            let before = shiftDay(meetingDate, by: -1)
            return before < week ? before : week
        }
        return week
    }
}
