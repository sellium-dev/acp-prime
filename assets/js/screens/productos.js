const CATEGORIES = [ 'Poleras/Camisetas', 'Shorts', 'Pantalones/Joggers', 'Zapatillas', 'Accesorios' ];
const DEFAULT_MARGIN_PERCENT = 30;

// Tallas de letra conocidas y su orden esperado — "XXL" y "2XL" (etc.) son
// la misma talla escrita distinto, así que comparten rango. Todo lo que no
// calce acá (números de calzado, o "modelo" de un negocio que no es de
// ropa) se ordena aparte: numérico primero, texto libre al final.
const SIZE_RANK = {
	XXS: 0,
	XS: 1,
	S: 2,
	M: 3,
	L: 4,
	XL: 5,
	XXL: 6,
	'2XL': 6,
	XXXL: 7,
	'3XL': 7,
	XXXXL: 8,
	'4XL': 8,
};

function sizeSortKey( size ) {
	const normalized = ( size || '' ).trim().toUpperCase();
	if ( normalized in SIZE_RANK ) {
		return [ 0, SIZE_RANK[ normalized ], normalized ];
	}
	const asNumber = Number( normalized );
	if ( '' !== normalized && ! Number.isNaN( asNumber ) ) {
		return [ 1, asNumber, normalized ];
	}
	return [ 2, 0, normalized ];
}

function compareBySize( a, b ) {
	const ka = sizeSortKey( a.size );
	const kb = sizeSortKey( b.size );
	if ( ka[ 0 ] !== kb[ 0 ] ) return ka[ 0 ] - kb[ 0 ];
	if ( ka[ 1 ] !== kb[ 1 ] ) return ka[ 1 ] - kb[ 1 ];
	return ka[ 2 ].localeCompare( kb[ 2 ] );
}

function sortVariantsBySize( variants ) {
	return [ ...variants ].sort( compareBySize );
}

export function renderProductos( main, ctx ) {
	const { supabase, org, canCreateProducts, canEditProducts } = ctx;
	// costo + este % = precio sugerido, configurable por empresa en Configuración
	const marginPercent = org.suggested_margin_percent ?? DEFAULT_MARGIN_PERCENT;
	const SUGGESTED_MARGIN = 1 + marginPercent / 100;
	let view = 'list';
	let products = [];
	let search = '';
	let sizeFilter = '';
	let editingProduct = null; // null = nuevo, objeto = editando
	let formName = '';
	let formCategory = '';
	let formDescription = '';
	let formLowStock = 1;
	let formVariants = [];
	let restockProduct = null;
	let restockRows = [];
	let saving = false;
	let errorMsg = '';

	load();

	async function load() {
		main.innerHTML = loadingHtml();
		const { data, error } = await supabase
			.from( 'products' )
			.select( 'id, name, category, description, active, low_stock_threshold, product_variants ( id, size, color, sku, price, cost, stock_quantity )' )
			.eq( 'organization_id', org.id )
			.order( 'created_at', { ascending: false } );

		if ( error ) {
			main.innerHTML = `<div class="acp-error">No se pudo cargar productos: ${ esc( error.message ) }</div>`;
			return;
		}
		products = data || [];
		draw();
	}

	function draw() {
		if ( 'form' === view ) {
			drawForm();
		} else if ( 'restock' === view ) {
			drawRestock();
		} else {
			drawList();
		}
	}

	function drawList() {
		const filtered = filterProducts();

		main.innerHTML = `
			<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Productos</div>
				${ canCreateProducts ? '<button type="button" class="acp-btn-primary" style="width:auto;padding:10px 18px" id="acp-new-product">+ Nuevo producto</button>' : '' }
			</div>
			<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
				<input id="p-search" placeholder="Buscar por nombre…" value="${ escAttr( search ) }"
					style="flex:1;min-width:200px;max-width:360px;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-size:14px;font-family:inherit;outline:none" />
				<input id="p-size-filter" placeholder="Talla…" value="${ escAttr( sizeFilter ) }"
					style="width:120px;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-size:14px;font-family:inherit;outline:none" />
			</div>
			${ 0 === filtered.length ? `<div class="acp-empty-state">${ 0 === products.length ? 'Todavía no hay productos cargados.' : 'Sin resultados para esa búsqueda.' }</div>` : '' }
			<div style="display:flex;flex-direction:column;gap:12px">
				${ filtered.map( productCardHtml ).join( '' ) }
			</div>
		`;

		const newBtn = document.getElementById( 'acp-new-product' );
		if ( newBtn ) {
			newBtn.addEventListener( 'click', () => openForm( null ) );
		}
		main.querySelectorAll( '[data-edit]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				const product = products.find( ( p ) => p.id === btn.dataset.edit );
				openForm( product );
			} );
		} );
		main.querySelectorAll( '[data-restock]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				const product = products.find( ( p ) => p.id === btn.dataset.restock );
				openRestock( product );
			} );
		} );

		const searchInput = document.getElementById( 'p-search' );
		searchInput.addEventListener( 'input', () => {
			search = searchInput.value;
			const caret = searchInput.selectionStart;
			draw();
			const restored = document.getElementById( 'p-search' );
			restored.focus();
			restored.setSelectionRange( caret, caret );
		} );

		const sizeInput = document.getElementById( 'p-size-filter' );
		sizeInput.addEventListener( 'input', () => {
			sizeFilter = sizeInput.value;
			const caret = sizeInput.selectionStart;
			draw();
			const restored = document.getElementById( 'p-size-filter' );
			restored.focus();
			restored.setSelectionRange( caret, caret );
		} );
	}

	function filterProducts() {
		let list = products;

		if ( '' !== search.trim() ) {
			const q = search.trim().toLowerCase();
			list = list.filter( ( p ) => p.name.toLowerCase().includes( q ) );
		}

		if ( '' !== sizeFilter.trim() ) {
			const s = sizeFilter.trim().toLowerCase();
			list = list.filter( ( p ) => ( p.product_variants || [] ).some( ( v ) => v.size.toLowerCase() === s && v.stock_quantity > 0 ) );
		}

		return list;
	}

	function productCardHtml( product ) {
		const s = sizeFilter.trim().toLowerCase();
		// Con el filtro de talla activo, solo se muestran las variantes que
		// calzan (y tienen stock) — filterProducts() ya se aseguró de que el
		// producto tenga al menos una, así que acá nunca queda la lista vacía.
		const variants = sortVariantsBySize(
			'' === s
				? product.product_variants || []
				: ( product.product_variants || [] ).filter( ( v ) => v.size.toLowerCase() === s && v.stock_quantity > 0 )
		);
		const totalStock = ( product.product_variants || [] ).reduce( ( sum, v ) => sum + v.stock_quantity, 0 );
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;gap:8px">
					<div style="font-size:15px;font-weight:700;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ esc( product.name ) }</div>
					${
						canEditProducts
							? `
						<div style="display:flex;gap:8px;flex-shrink:0">
							<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 14px" data-restock="${ product.id }">Reponer stock</button>
							<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 14px" data-edit="${ product.id }">Editar</button>
						</div>
					`
							: ''
					}
				</div>
				<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">${ esc( product.category ) } · ${ totalStock } en stock · mínimo ${ product.low_stock_threshold }</div>
				<div style="display:flex;flex-direction:column;gap:6px">
					${ variants
						.map(
							( v ) => `
						<div style="display:flex;align-items:center;gap:12px;font-size:13px;padding:6px 0;border-top:1px solid var(--border)">
							<div style="flex:1">${ esc( v.size ) }${ v.color ? ' · ' + esc( v.color ) : '' }</div>
							<div style="color:var(--text-muted)">Costo ${ money( v.cost ) }</div>
							<div style="font-weight:700">Precio ${ money( v.price ) }</div>
							<div style="color:var(--text-muted);width:70px;text-align:right">Stock ${ v.stock_quantity }</div>
						</div>
					`
						)
						.join( '' ) }
				</div>
			</div>
		`;
	}

	function openForm( product ) {
		editingProduct = product;
		formName = product?.name || '';
		formCategory = product?.category || '';
		formDescription = product?.description || '';
		formLowStock = product?.low_stock_threshold ?? 1;
		formVariants = product
			? sortVariantsBySize( product.product_variants ).map( ( v ) => ( { ...v } ) )
			: [ emptyVariant() ];
		errorMsg = '';
		view = 'form';
		draw();
	}

	// Se llama SIEMPRE antes de cualquier draw() disparado desde dentro del
	// formulario (guardar, incluso si falla la validación) — si no, un
	// error de validación redibuja el formulario desde estos valores
	// desactualizados y borra (o revierte) lo que la persona ya tecleó.
	function syncFormFieldsFromDom() {
		formName = document.getElementById( 'p-name' ).value;
		formCategory = document.getElementById( 'p-category' ).value;
		formDescription = document.getElementById( 'p-description' ).value;
		formLowStock = document.getElementById( 'p-low-stock' ).value;
	}

	function emptyVariant() {
		return { id: null, size: '', color: '', price: '', cost: '', stock_quantity: '' };
	}

	async function openRestock( product ) {
		restockProduct = product;
		const variantIds = ( product.product_variants || [] ).map( ( v ) => v.id );

		// El lote más reciente de cada variante — para poder ofrecer "es el
		// mismo lote que la última reposición" en vez de crear uno nuevo.
		const latestLotByVariant = new Map();
		if ( variantIds.length > 0 ) {
			const { data: lots } = await supabase
				.from( 'stock_lots' )
				.select( 'id, product_variant_id, quantity, remaining_quantity, unit_cost, created_at' )
				.in( 'product_variant_id', variantIds )
				.order( 'created_at', { ascending: false } );
			( lots || [] ).forEach( ( lot ) => {
				if ( ! latestLotByVariant.has( lot.product_variant_id ) ) {
					latestLotByVariant.set( lot.product_variant_id, lot );
				}
			} );
		}

		restockRows = sortVariantsBySize( product.product_variants || [] ).map( ( v ) => ( {
			id: v.id,
			size: v.size,
			color: v.color,
			stock_quantity: v.stock_quantity,
			cost: v.cost,
			price: v.price,
			latestLot: latestLotByVariant.get( v.id ) || null,
		} ) );
		errorMsg = '';
		view = 'restock';
		draw();
	}

	function drawRestock() {
		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Reponer stock — ${ esc( restockProduct.name ) }</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px;max-width:720px">
				<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 12px;font-size:12px;margin-bottom:12px" id="r-shipping-toggle">+ Agregar costo de envío</button>
				<div id="r-shipping-box" style="display:none;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;max-width:360px">
					<div class="acp-field" style="margin-bottom:6px">
						<label>Costo de envío total</label>
						<input id="r-shipping-cost" type="number" step="0.01" placeholder="0" />
					</div>
					<div id="r-shipping-summary" style="font-size:12px;color:var(--text-muted)"></div>
				</div>

				<div id="r-rows">
					${ restockRows
						.map(
							( r, i ) => `
						<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px" data-restock-row="${ i }">
							<div style="font-size:13px;font-weight:600;margin-bottom:8px">${ esc( r.size ) }${ r.color ? ' · ' + esc( r.color ) : '' } <span style="font-weight:400;color:var(--text-muted)">— stock actual ${ r.stock_quantity }, precio actual ${ money( r.price ) }</span></div>
							<div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:8px">
								<input placeholder="Cantidad a agregar" class="r-qty" type="number" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
								<input placeholder="Costo" class="r-cost" type="number" step="0.01" value="${ escAttr( r.cost ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
								<input placeholder="Precio" class="r-price" type="number" step="0.01" value="${ escAttr( r.price ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
							</div>
							${
								r.latestLot
									? `
								<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);cursor:pointer;margin-top:8px">
									<input type="checkbox" class="r-same-lot" style="margin:0" />
									Es el mismo lote que la última reposición (${ formatLotDate( r.latestLot.created_at ) }, costo ${ money( r.latestLot.unit_cost ) })
								</label>
							`
									: '<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Este será su primer lote registrado.</div>'
							}
							<div class="r-hint" style="font-size:12px;color:var(--text-muted);margin-top:6px"></div>
						</div>
					`
						)
						.join( '' ) }
				</div>

				<div style="display:flex;gap:10px;margin-top:24px">
					<button type="button" class="acp-btn-primary" style="width:auto;padding:12px 22px" id="r-save" ${ saving ? 'disabled' : '' }>${ saving ? 'Guardando…' : 'Guardar' }</button>
					<button type="button" class="acp-btn-secondary" style="width:auto;padding:12px 22px" id="r-cancel">Cancelar</button>
				</div>
			</div>
		`;

		document.getElementById( 'r-cancel' ).addEventListener( 'click', () => {
			view = 'list';
			draw();
		} );
		document.getElementById( 'r-save' ).addEventListener( 'click', handleRestockSave );

		const shippingToggle = document.getElementById( 'r-shipping-toggle' );
		shippingToggle.addEventListener( 'click', () => {
			const box = document.getElementById( 'r-shipping-box' );
			const isHidden = 'none' === box.style.display;
			box.style.display = isHidden ? 'block' : 'none';
			shippingToggle.textContent = isHidden ? 'Quitar costo de envío' : '+ Agregar costo de envío';
			if ( isHidden ) {
				document.getElementById( 'r-shipping-cost' ).focus();
			} else {
				document.getElementById( 'r-shipping-cost' ).value = '';
			}
			updateRestockHints();
		} );

		main.addEventListener( 'input', ( e ) => {
			if ( e.target.matches( '.r-qty, .r-cost, .r-price, #r-shipping-cost' ) ) {
				updateRestockHints();
			}
		} );

		updateRestockHints();
	}

	// El envío se reparte entre las unidades que se están AGREGANDO en esta
	// reposición (no entre el stock total ya existente) — si pediste 24
	// camisetas nuevas repartidas en varias tallas en un solo paquete, se
	// divide entre esas 24, sin contar el stock que ya tenías antes.
	function restockShippingPerUnitFromDom() {
		const box = document.getElementById( 'r-shipping-box' );
		if ( ! box || 'none' === box.style.display ) {
			return { shippingCost: 0, totalQty: 0, perUnit: 0 };
		}
		const shippingCost = parseFloat( document.getElementById( 'r-shipping-cost' ).value ) || 0;
		const rows = document.querySelectorAll( '#r-rows [data-restock-row]' );
		const totalQty = Array.from( rows ).reduce( ( sum, row ) => sum + ( parseInt( row.querySelector( '.r-qty' ).value, 10 ) || 0 ), 0 );
		return { shippingCost, totalQty, perUnit: totalQty > 0 ? shippingCost / totalQty : 0 };
	}

	function updateRestockHints() {
		const { shippingCost, totalQty, perUnit } = restockShippingPerUnitFromDom();

		document.querySelectorAll( '#r-rows [data-restock-row]' ).forEach( ( row, i ) => {
			const addQty = parseInt( row.querySelector( '.r-qty' ).value, 10 ) || 0;
			const baseCost = parseFloat( row.querySelector( '.r-cost' ).value ) || 0;
			const hint = row.querySelector( '.r-hint' );
			if ( addQty > 0 ) {
				const finalCost = baseCost + perUnit;
				const newStock = restockRows[ i ].stock_quantity + addQty;
				const suggested = Math.round( finalCost * SUGGESTED_MARGIN );
				hint.textContent =
					`Quedará en ${ newStock } unidades` +
					( perUnit > 0 ? ` · costo final ${ money( finalCost ) }` : '' ) +
					` · precio sugerido ${ money( suggested ) } (${ marginPercent }%)`;
			} else {
				hint.textContent = '';
			}
		} );

		const summary = document.getElementById( 'r-shipping-summary' );
		if ( ! summary ) return;
		if ( shippingCost > 0 && totalQty > 0 ) {
			summary.textContent = `Se reparte ${ money( shippingCost ) } entre ${ totalQty } unidades → +${ money( Math.round( perUnit ) ) } de costo por unidad.`;
		} else if ( shippingCost > 0 ) {
			summary.textContent = 'Indica cuántas unidades llegan de cada variante para repartir el envío.';
		} else {
			summary.textContent = '';
		}
	}

	async function handleRestockSave() {
		const { perUnit } = restockShippingPerUnitFromDom();
		const rows = document.querySelectorAll( '#r-rows [data-restock-row]' );

		const updates = [];
		rows.forEach( ( row, i ) => {
			const addQty = parseInt( row.querySelector( '.r-qty' ).value, 10 ) || 0;
			if ( addQty <= 0 ) return;
			const baseCost = parseFloat( row.querySelector( '.r-cost' ).value ) || 0;
			const cost = Math.round( ( baseCost + perUnit ) * 100 ) / 100;
			const price = parseFloat( row.querySelector( '.r-price' ).value ) || 0;
			const sameLotCheckbox = row.querySelector( '.r-same-lot' );
			updates.push( {
				variantId: restockRows[ i ].id,
				stock_quantity: restockRows[ i ].stock_quantity + addQty,
				cost,
				price,
				addQty,
				latestLot: restockRows[ i ].latestLot,
				sameLot: !! ( sameLotCheckbox && sameLotCheckbox.checked ),
			} );
		} );

		if ( 0 === updates.length ) {
			errorMsg = 'Indica la cantidad a agregar de al menos una variante.';
			draw();
			return;
		}

		saving = true;
		draw();

		try {
			for ( const u of updates ) {
				const { error } = await supabase
					.from( 'product_variants' )
					.update( { stock_quantity: u.stock_quantity, cost: u.cost, price: u.price } )
					.eq( 'id', u.variantId );
				if ( error ) throw error;

				if ( u.sameLot && u.latestLot ) {
					// Se funde con el lote más reciente: el costo queda como
					// promedio ponderado entre lo que quedaba de ese lote y lo
					// que entra ahora — no se toca created_at (sigue siendo el
					// más antiguo para efectos de FIFO).
					const lot = u.latestLot;
					const newRemaining = lot.remaining_quantity + u.addQty;
					const newQuantity = lot.quantity + u.addQty;
					const newUnitCost =
						newRemaining > 0
							? Math.round( ( ( lot.remaining_quantity * lot.unit_cost + u.addQty * u.cost ) / newRemaining ) * 100 ) / 100
							: u.cost;
					const { error: lotError } = await supabase
						.from( 'stock_lots' )
						.update( { quantity: newQuantity, remaining_quantity: newRemaining, unit_cost: newUnitCost } )
						.eq( 'id', lot.id );
					if ( lotError ) throw lotError;
				} else {
					const { error: lotError } = await supabase.from( 'stock_lots' ).insert( {
						organization_id: org.id,
						product_variant_id: u.variantId,
						quantity: u.addQty,
						remaining_quantity: u.addQty,
						unit_cost: u.cost,
					} );
					if ( lotError ) throw lotError;
				}
			}
			saving = false;
			view = 'list';
			await load();
		} catch ( err ) {
			saving = false;
			errorMsg = 'No se pudo reponer: ' + err.message;
			draw();
		}
	}

	function drawForm() {
		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">${ editingProduct ? 'Editar producto' : 'Nuevo producto' }</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px;max-width:720px">
				<div class="acp-field">
					<label>Nombre</label>
					<input id="p-name" value="${ escAttr( formName ) }" />
				</div>
				<div class="acp-field" style="position:relative">
					<label>Categoría</label>
					<input id="p-category" autocomplete="off" placeholder="Elige una o escribe una nueva" value="${ escAttr( formCategory ) }" />
					<div id="p-category-suggestions" class="acp-suggestions" style="display:none"></div>
				</div>
				<div class="acp-field">
					<label>Descripción (opcional)</label>
					<input id="p-description" value="${ escAttr( formDescription ) }" />
				</div>
				<div class="acp-field" style="max-width:200px">
					<label>Stock mínimo</label>
					<input id="p-low-stock" type="number" min="0" step="1" value="${ escAttr( formLowStock ) }" />
					<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Debajo de esto, avisa en el Dashboard que el stock está bajo.</div>
				</div>

				<div style="font-size:13px;font-weight:700;margin:20px 0 10px">Variantes (talla o modelo / color)</div>

				<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 12px;font-size:12px;margin-bottom:12px" id="p-shipping-toggle">+ Agregar costo de envío</button>
				<div id="p-shipping-box" style="display:none;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;max-width:360px">
					<div class="acp-field" style="margin-bottom:6px">
						<label>Costo de envío total</label>
						<input id="p-shipping-cost" type="number" step="0.01" placeholder="0" />
					</div>
					<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);cursor:pointer;margin-bottom:8px">
						<input type="checkbox" id="p-shipping-margin" style="margin:0" />
						Aplicar el ${ marginPercent }% de ganancia también al costo de envío
					</label>
					<div id="p-shipping-summary" style="font-size:12px;color:var(--text-muted)"></div>
				</div>

				<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 12px;font-size:12px;margin-bottom:12px" id="p-bulk-toggle">+ Cargar varias tallas a la vez</button>
				<div id="p-bulk-box" style="display:none;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;max-width:480px">
					<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Para cuando el color, costo y precio son los mismos y solo cambia la talla y el stock — escribe eso una vez y se genera una fila por talla.</div>
					<div class="acp-field" style="margin-bottom:8px">
						<label>Color (opcional, se aplica a todas)</label>
						<input id="bulk-color" placeholder="Negro" style="padding:9px 10px" />
					</div>
					<div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px;margin-bottom:8px">
						<div class="acp-field" style="margin-bottom:0">
							<label>Costo</label>
							<input id="bulk-cost" type="number" step="0.01" style="padding:9px 10px" />
						</div>
						<div class="acp-field" style="margin-bottom:0">
							<label>Precio (opcional)</label>
							<input id="bulk-price" type="number" step="0.01" style="padding:9px 10px" />
						</div>
					</div>
					<div class="acp-field" style="margin-bottom:8px">
						<label>Tallas (separadas por coma)</label>
						<input id="bulk-sizes" placeholder="S, M, L" style="padding:9px 10px" />
					</div>
					<div id="bulk-stock-rows"></div>
					<button type="button" class="acp-btn-primary" id="bulk-apply" style="width:auto;padding:8px 16px;margin-top:8px">Agregar estas variantes</button>
				</div>

				<div id="p-variants"></div>
				<button type="button" class="acp-btn-secondary" style="width:auto;padding:8px 14px;margin-top:6px" id="p-add-variant">+ Agregar variante</button>

				<div style="display:flex;gap:10px;margin-top:24px">
					<button type="button" class="acp-btn-primary" style="width:auto;padding:12px 22px" id="p-save" ${ saving ? 'disabled' : '' }>${ saving ? 'Guardando…' : 'Guardar' }</button>
					<button type="button" class="acp-btn-secondary" style="width:auto;padding:12px 22px" id="p-cancel">Cancelar</button>
				</div>
			</div>
		`;

		drawVariantRows();
		wireCategoryField();

		document.getElementById( 'p-add-variant' ).addEventListener( 'click', () => {
			syncFormVariantsFromDom();
			formVariants.push( emptyVariant() );
			drawVariantRows();
		} );
		document.getElementById( 'p-cancel' ).addEventListener( 'click', () => {
			view = 'list';
			draw();
		} );
		document.getElementById( 'p-save' ).addEventListener( 'click', handleSave );

		const shippingToggle = document.getElementById( 'p-shipping-toggle' );
		shippingToggle.addEventListener( 'click', () => {
			const box = document.getElementById( 'p-shipping-box' );
			const isHidden = 'none' === box.style.display;
			box.style.display = isHidden ? 'block' : 'none';
			shippingToggle.textContent = isHidden ? 'Quitar costo de envío' : '+ Agregar costo de envío';
			if ( isHidden ) {
				document.getElementById( 'p-shipping-cost' ).focus();
			} else {
				document.getElementById( 'p-shipping-cost' ).value = '';
			}
			updatePriceSuggestions();
		} );

		// Delegado en vez de un listener por fila: así las variantes que se
		// agreguen después (+ Agregar variante) quedan cubiertas sin volver a
		// engancharlas una por una.
		main.addEventListener( 'input', ( e ) => {
			if ( e.target.matches( '.v-cost, .v-stock, #p-shipping-cost, #p-shipping-margin' ) ) {
				updatePriceSuggestions();
			}
			if ( e.target.id === 'bulk-sizes' ) {
				drawBulkStockRows();
			}
		} );

		const bulkToggle = document.getElementById( 'p-bulk-toggle' );
		bulkToggle.addEventListener( 'click', () => {
			const box = document.getElementById( 'p-bulk-box' );
			const isHidden = 'none' === box.style.display;
			box.style.display = isHidden ? 'block' : 'none';
			bulkToggle.textContent = isHidden ? 'Ocultar carga rápida' : '+ Cargar varias tallas a la vez';
			if ( isHidden ) {
				document.getElementById( 'bulk-color' ).focus();
			}
		} );
		document.getElementById( 'bulk-apply' ).addEventListener( 'click', handleBulkApply );
	}

	// Lee "S, M, L" y dibuja un input de stock por cada talla — el color,
	// costo y precio se escriben una sola vez y se aplican a todas.
	function drawBulkStockRows() {
		const wrap = document.getElementById( 'bulk-stock-rows' );
		const sizesInput = document.getElementById( 'bulk-sizes' );
		if ( ! wrap || ! sizesInput ) return;

		const sizes = Array.from( new Set( sizesInput.value.split( ',' ).map( ( s ) => s.trim() ).filter( Boolean ) ) );

		wrap.innerHTML = sizes
			.map(
				( size, i ) => `
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px" data-bulk-size="${ escAttr( size ) }">
				<div style="flex:1;font-size:13px">${ esc( size ) }</div>
				<input class="bulk-stock" type="number" placeholder="Stock" style="width:100px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:13px;font-family:inherit" />
			</div>
		`
			)
			.join( '' );
	}

	function handleBulkApply() {
		const color = document.getElementById( 'bulk-color' ).value.trim();
		const cost = document.getElementById( 'bulk-cost' ).value;
		const price = document.getElementById( 'bulk-price' ).value;
		const rows = document.querySelectorAll( '#bulk-stock-rows [data-bulk-size]' );

		if ( 0 === rows.length ) {
			errorMsg = 'Escribe al menos una talla para cargar en lote.';
			draw();
			return;
		}

		syncFormVariantsFromDom();

		// Si la única fila que hay es la vacía por defecto de "Nuevo producto",
		// no la dejamos suelta — se reemplaza por las del lote.
		formVariants = formVariants.filter(
			( v ) => v.id || v.size || v.color || v.cost || v.price || v.stock_quantity
		);

		rows.forEach( ( row ) => {
			formVariants.push( {
				id: null,
				size: row.dataset.bulkSize,
				color: color || '',
				cost,
				price,
				stock_quantity: row.querySelector( '.bulk-stock' ).value,
			} );
		} );

		errorMsg = '';
		drawVariantRows();

		// Limpiar y cerrar la caja para el próximo lote (ej. otro color).
		document.getElementById( 'bulk-color' ).value = '';
		document.getElementById( 'bulk-cost' ).value = '';
		document.getElementById( 'bulk-price' ).value = '';
		document.getElementById( 'bulk-sizes' ).value = '';
		document.getElementById( 'bulk-stock-rows' ).innerHTML = '';
		const box = document.getElementById( 'p-bulk-box' );
		box.style.display = 'none';
		document.getElementById( 'p-bulk-toggle' ).textContent = '+ Cargar varias tallas a la vez';
	}

	// El costo de envío se reparte entre las unidades totales de todas las
	// variantes (ej. pediste 24 camisetas en un solo paquete: el envío se
	// divide entre esas 24, sin importar cómo quedaron repartidas por
	// talla/color) y ese pedazo se suma al costo base de cada fila. Nunca
	// modifica lo que el usuario tecleó en "Costo" — solo actualiza el
	// placeholder de "Precio" y el resumen; el cálculo real que se guarda
	// pasa por readVariantsFromDom() al momento de guardar.
	function shippingPerUnitFromDom() {
		const box = document.getElementById( 'p-shipping-box' );
		if ( ! box || 'none' === box.style.display ) {
			return { shippingCost: 0, totalUnits: 0, perUnit: 0 };
		}
		const shippingCost = parseFloat( document.getElementById( 'p-shipping-cost' ).value ) || 0;
		const rows = document.querySelectorAll( '#p-variants [data-row]' );
		const totalUnits = Array.from( rows ).reduce( ( sum, row ) => sum + ( parseInt( row.querySelector( '.v-stock' ).value, 10 ) || 0 ), 0 );
		return { shippingCost, totalUnits, perUnit: totalUnits > 0 ? shippingCost / totalUnits : 0 };
	}

	// El checkbox decide si el % de ganancia también se calcula sobre la
	// parte de envío, o si el envío se traspasa "a costo" (sin margen) y
	// solo el costo del producto lleva el margen — el usuario no tenía
	// claro cuál es más correcto para su negocio, así que queda como opción.
	function marginAppliesToShipping() {
		const checkbox = document.getElementById( 'p-shipping-margin' );
		return !! ( checkbox && checkbox.checked );
	}

	function suggestedPrice( baseCost, perUnit ) {
		return marginAppliesToShipping()
			? Math.round( ( baseCost + perUnit ) * SUGGESTED_MARGIN )
			: Math.round( baseCost * SUGGESTED_MARGIN + perUnit );
	}

	function updatePriceSuggestions() {
		const { shippingCost, totalUnits, perUnit } = shippingPerUnitFromDom();

		document.querySelectorAll( '#p-variants [data-row]' ).forEach( ( row ) => {
			const cost = parseFloat( row.querySelector( '.v-cost' ).value ) || 0;
			const priceInput = row.querySelector( '.v-price' );
			priceInput.placeholder = ( cost > 0 || perUnit > 0 ) ? 'Sugerido ' + money( suggestedPrice( cost, perUnit ) ) : 'Precio';
		} );

		const summary = document.getElementById( 'p-shipping-summary' );
		if ( ! summary ) return;
		if ( shippingCost > 0 && totalUnits > 0 ) {
			summary.textContent = `Se reparte ${ money( shippingCost ) } entre ${ totalUnits } unidades → +${ money( Math.round( perUnit ) ) } de costo por unidad.`;
		} else if ( shippingCost > 0 ) {
			summary.textContent = 'Coloca el stock de las variantes para repartir el envío.';
		} else {
			summary.textContent = '';
		}
	}

	function wireCategoryField() {
		const input = document.getElementById( 'p-category' );
		const list = document.getElementById( 'p-category-suggestions' );

		function showSuggestions() {
			const q = input.value.trim().toLowerCase();
			const matches = CATEGORIES.filter( ( c ) => '' === q || c.toLowerCase().includes( q ) );
			if ( 0 === matches.length ) {
				list.style.display = 'none';
				return;
			}
			list.innerHTML = matches
				.map( ( c ) => `<div class="acp-suggestion-item" data-value="${ escAttr( c ) }">${ esc( c ) }</div>` )
				.join( '' );
			list.style.display = 'block';
			list.querySelectorAll( '[data-value]' ).forEach( ( item ) => {
				// mousedown (not click) fires before the input's blur, so the
				// value gets set before the list disappears.
				item.addEventListener( 'mousedown', ( e ) => {
					e.preventDefault();
					input.value = item.dataset.value;
					list.style.display = 'none';
				} );
			} );
		}

		input.addEventListener( 'focus', showSuggestions );
		input.addEventListener( 'input', showSuggestions );
		input.addEventListener( 'blur', () => {
			list.style.display = 'none';
		} );
	}

	function drawVariantRows() {
		const wrap = document.getElementById( 'p-variants' );
		wrap.innerHTML = formVariants
			.map(
				( v, i ) => `
			<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px" data-row="${ i }">
				<div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr)) auto;gap:8px;margin-bottom:8px;align-items:center">
					<input placeholder="Talla/Modelo" class="v-size" value="${ escAttr( v.size ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
					<input placeholder="Color" class="v-color" value="${ escAttr( v.color || '' ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
					<input placeholder="Costo" class="v-cost" type="number" step="0.01" value="${ escAttr( v.cost ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
					<button type="button" class="v-remove" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px">&times;</button>
				</div>
				<div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px">
					<input placeholder="Precio" class="v-price" type="number" step="0.01" value="${ escAttr( v.price ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
					<input placeholder="Stock" class="v-stock" type="number" value="${ escAttr( v.stock_quantity ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
				</div>
			</div>
		`
			)
			.join( '' );

		wrap.querySelectorAll( '.v-remove' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				syncFormVariantsFromDom();
				const i = Number( btn.closest( '[data-row]' ).dataset.row );
				formVariants.splice( i, 1 );
				if ( 0 === formVariants.length ) {
					formVariants.push( emptyVariant() );
				}
				drawVariantRows();
			} );
		} );

		updatePriceSuggestions();
	}

	// Lo que el usuario ya tecleó en los inputs vive solo en el DOM hasta que
	// se guarda — si redibujamos las filas (agregar/quitar variante) sin
	// copiar esos valores de vuelta a formVariants primero, se pierden.
	function syncFormVariantsFromDom() {
		const rows = document.querySelectorAll( '#p-variants [data-row]' );
		rows.forEach( ( row, i ) => {
			if ( ! formVariants[ i ] ) return;
			formVariants[ i ] = {
				...formVariants[ i ],
				size: row.querySelector( '.v-size' ).value,
				color: row.querySelector( '.v-color' ).value,
				cost: row.querySelector( '.v-cost' ).value,
				price: row.querySelector( '.v-price' ).value,
				stock_quantity: row.querySelector( '.v-stock' ).value,
			};
		} );
	}

	function readVariantsFromDom() {
		const { perUnit } = shippingPerUnitFromDom();
		const rows = document.querySelectorAll( '#p-variants [data-row]' );

		return Array.from( rows ).map( ( row, i ) => {
			const baseCost = parseFloat( row.querySelector( '.v-cost' ).value ) || 0;
			const cost = Math.round( ( baseCost + perUnit ) * 100 ) / 100;
			const priceRaw = row.querySelector( '.v-price' ).value.trim();
			// Precio en blanco = usa la sugerencia (costo + % configurado, ver
			// suggestedPrice) en vez de dejarlo en 0 — así el producto queda
			// con un precio de venta utilizable aunque todavía no se haya
			// decidido el precio final.
			const price = '' !== priceRaw ? parseFloat( priceRaw ) || 0 : suggestedPrice( baseCost, perUnit );
			return {
				id: formVariants[ i ].id,
				size: row.querySelector( '.v-size' ).value.trim(),
				color: row.querySelector( '.v-color' ).value.trim() || null,
				cost,
				price,
				stock_quantity: parseInt( row.querySelector( '.v-stock' ).value, 10 ) || 0,
			};
		} );
	}

	async function handleSave() {
		// Antes de cualquier chance de que la validación falle y dispare un
		// draw(): guarda lo que hay en el DOM ahora mismo, para que si el
		// formulario se redibuja por un error, no pierda ni revierta nada.
		syncFormFieldsFromDom();
		syncFormVariantsFromDom();

		const name = formName.trim();
		const category = formCategory;
		const description = formDescription.trim();
		const lowStockThreshold = parseInt( formLowStock, 10 );
		const variants = readVariantsFromDom();

		if ( '' === name ) {
			errorMsg = 'El nombre es obligatorio.';
			draw();
			return;
		}
		if ( variants.some( ( v ) => '' === v.size ) ) {
			errorMsg = 'Todas las variantes necesitan una talla o modelo.';
			draw();
			return;
		}
		if ( Number.isNaN( lowStockThreshold ) || lowStockThreshold < 0 ) {
			errorMsg = 'El stock mínimo debe ser un número igual o mayor a 0.';
			draw();
			return;
		}

		saving = true;
		draw();

		try {
			let productId = editingProduct?.id;

			if ( productId ) {
				const { error } = await supabase
					.from( 'products' )
					.update( { name, category, description: description || null, low_stock_threshold: lowStockThreshold } )
					.eq( 'id', productId );
				if ( error ) throw error;
			} else {
				const { data, error } = await supabase
					.from( 'products' )
					.insert( { organization_id: org.id, name, category, description: description || null, low_stock_threshold: lowStockThreshold } )
					.select( 'id' )
					.single();
				if ( error ) throw error;
				productId = data.id;
			}

			const originalIds = ( editingProduct?.product_variants || [] ).map( ( v ) => v.id );
			const keptIds = variants.filter( ( v ) => v.id ).map( ( v ) => v.id );
			const removedIds = originalIds.filter( ( id ) => ! keptIds.includes( id ) );

			if ( removedIds.length > 0 ) {
				const { error } = await supabase.from( 'product_variants' ).delete().in( 'id', removedIds );
				if ( error ) throw error;
			}

			const toUpdate = variants.filter( ( v ) => v.id );
			for ( const v of toUpdate ) {
				const { error } = await supabase
					.from( 'product_variants' )
					.update( { size: v.size, color: v.color, cost: v.cost, price: v.price, stock_quantity: v.stock_quantity } )
					.eq( 'id', v.id );
				if ( error ) throw error;
			}

			const toInsert = variants
				.filter( ( v ) => ! v.id )
				.map( ( v ) => ( {
					product_id: productId,
					organization_id: org.id,
					size: v.size,
					color: v.color,
					cost: v.cost,
					price: v.price,
					stock_quantity: v.stock_quantity,
				} ) );
			if ( toInsert.length > 0 ) {
				const { data: insertedVariants, error } = await supabase.from( 'product_variants' ).insert( toInsert ).select( 'id, cost, stock_quantity' );
				if ( error ) throw error;

				// El stock inicial de una variante nueva es, por definición, su
				// primer lote — no hace falta preguntar nada, a diferencia de
				// "Reponer stock" donde sí puede ser una compra distinta.
				const newLots = ( insertedVariants || [] )
					.filter( ( v ) => v.stock_quantity > 0 )
					.map( ( v ) => ( {
						organization_id: org.id,
						product_variant_id: v.id,
						quantity: v.stock_quantity,
						remaining_quantity: v.stock_quantity,
						unit_cost: v.cost,
					} ) );
				if ( newLots.length > 0 ) {
					const { error: lotError } = await supabase.from( 'stock_lots' ).insert( newLots );
					if ( lotError ) throw lotError;
				}
			}

			saving = false;
			view = 'list';
			await load();
		} catch ( err ) {
			saving = false;
			errorMsg = 'No se pudo guardar: ' + err.message;
			draw();
		}
	}
}

function loadingHtml() {
	return '<div class="acp-empty-state">Cargando…</div>';
}

function money( n ) {
	return '$' + Number( n ).toLocaleString( 'es-CL', { maximumFractionDigits: 0 } );
}

function formatLotDate( isoString ) {
	return new Date( isoString ).toLocaleDateString( 'es-CL', { day: '2-digit', month: '2-digit' } );
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}

function escAttr( val ) {
	return esc( String( val ?? '' ) );
}
