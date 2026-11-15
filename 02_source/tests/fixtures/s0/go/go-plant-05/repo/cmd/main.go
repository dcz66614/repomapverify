package main

import (
	asvc "example.com/demo/internal/a/svc"
	bsvc "example.com/demo/internal/b/svc"
)

func main() { asvc.Run(); bsvc.Run() }
