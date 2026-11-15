package main

import (
	"fmt"
	"example.com/demo/internal/app"
	"example.com/demo/internal/gen"
	"example.com/demo/internal/native"
	"example.com/demo/internal/onlygen"
	"example.com/shared/util"
)

func main() { fmt.Println(app.Name, gen.X, native.Y, onlygen.Z, util.W) }
