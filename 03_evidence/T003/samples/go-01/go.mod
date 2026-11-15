module example.com/demo

go 1.25

replace example.com/shared => ./third_party/shared

require example.com/shared v0.0.0-00010101000000-000000000000
