import SwiftUI

// Shared constants mirrored from the web/native clients (ui.ts).

let GENRES: [String] = [
    "Fiction", "Mystery", "Thriller", "Science Fiction", "Fantasy", "Romance",
    "Horror", "Classics", "Poetry", "History", "Biography", "Memoir",
    "Science", "Self Development", "Young Adult", "Comics and Graphic Novels",
]

let AUDIENCES: [String] = ["Kids", "Teens", "Young adults", "Adults", "Seniors"]

struct Place: Identifiable, Hashable {
    var id: String { label }
    let label: String
    let lat: Double
    let lng: Double
}

/// Standardized place list for in-person clubs (picked, never free-typed).
let PLACES: [Place] = [
    Place(label: "Seattle, WA", lat: 47.6062, lng: -122.3321),
    Place(label: "Bellevue, WA", lat: 47.6101, lng: -122.2015),
    Place(label: "Portland, OR", lat: 45.5152, lng: -122.6784),
    Place(label: "San Francisco, CA", lat: 37.7749, lng: -122.4194),
    Place(label: "San Jose, CA", lat: 37.3387, lng: -121.8853),
    Place(label: "Los Angeles, CA", lat: 34.0522, lng: -118.2437),
    Place(label: "San Diego, CA", lat: 32.7157, lng: -117.1611),
    Place(label: "Sacramento, CA", lat: 38.5816, lng: -121.4944),
    Place(label: "Phoenix, AZ", lat: 33.4484, lng: -112.074),
    Place(label: "Las Vegas, NV", lat: 36.1699, lng: -115.1398),
    Place(label: "Salt Lake City, UT", lat: 40.7608, lng: -111.891),
    Place(label: "Denver, CO", lat: 39.7392, lng: -104.9903),
    Place(label: "Austin, TX", lat: 30.2672, lng: -97.7431),
    Place(label: "Dallas, TX", lat: 32.7767, lng: -96.797),
    Place(label: "Houston, TX", lat: 29.7604, lng: -95.3698),
    Place(label: "Minneapolis, MN", lat: 44.9778, lng: -93.265),
    Place(label: "Chicago, IL", lat: 41.8781, lng: -87.6298),
    Place(label: "Nashville, TN", lat: 36.1627, lng: -86.7816),
    Place(label: "Atlanta, GA", lat: 33.749, lng: -84.388),
    Place(label: "Miami, FL", lat: 25.7617, lng: -80.1918),
    Place(label: "Washington, DC", lat: 38.9072, lng: -77.0369),
    Place(label: "Philadelphia, PA", lat: 39.9526, lng: -75.1652),
    Place(label: "New York, NY", lat: 40.7128, lng: -74.006),
    Place(label: "Brooklyn, NY", lat: 40.6782, lng: -73.9442),
    Place(label: "Boston, MA", lat: 42.3601, lng: -71.0589),
]

extension Color {
    /// Deep plum from the Reading Peeps icon palette (#2e0e28).
    static let rpPlum = Color(red: 46.0 / 255.0, green: 14.0 / 255.0, blue: 40.0 / 255.0)
    /// Coral accent (#c93a54): ratings, primary actions.
    static let rpCoral = Color(red: 201.0 / 255.0, green: 58.0 / 255.0, blue: 84.0 / 255.0)
    /// Violet accent (#8b5cf6): polls.
    static let rpViolet = Color(red: 139.0 / 255.0, green: 92.0 / 255.0, blue: 246.0 / 255.0)
    /// Teal accent (#17a398): reading progress.
    static let rpTeal = Color(red: 23.0 / 255.0, green: 163.0 / 255.0, blue: 152.0 / 255.0)
    /// Cream page background (#fff9f1), the web app's page color.
    static let rpCream = Color(red: 255.0 / 255.0, green: 249.0 / 255.0, blue: 241.0 / 255.0)
    /// Deep plum page frame (#3d1436), the web app's background around the
    /// cream cards, and the color the app icon is drawn from.
    static let rpPlumBg = Color(red: 61.0 / 255.0, green: 20.0 / 255.0, blue: 54.0 / 255.0)
    /// Ink text color (#3a1b2e), the web app's plum-brown text.
    static let rpInk = Color(red: 58.0 / 255.0, green: 27.0 / 255.0, blue: 46.0 / 255.0)
    /// Pale pink pill background (#f7e3ee) for rating pills.
    static let rpPill = Color(red: 247.0 / 255.0, green: 227.0 / 255.0, blue: 238.0 / 255.0)
    /// Avatar palette in the web app's order: coral, violet, teal, blue, rose.
    static let rpAvatarColors: [Color] = [
        rpCoral, rpViolet, rpTeal,
        Color(red: 27.0 / 255.0, green: 143.0 / 255.0, blue: 168.0 / 255.0),
        Color(red: 249.0 / 255.0, green: 93.0 / 255.0, blue: 106.0 / 255.0),
    ]
}
