module example.com/m

go 1.25

replace example.com/a => ./local/a

replace example.com/b => example.com/c v2.0.0

replace example.com/d => ../outside-d
